import asyncio
import base64
import hashlib
import json
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.agents import planning_audit as planning_audit_agent
from app.agents import planning_comparable_patterns as planning_comparable_patterns_agent
from app.agents import planning_content_draft as planning_content_draft_agent
from app.agents import planning_recommendations as planning_recommendations_agent
from app.agents import planning_review_insights as planning_review_insights_agent
from app.agents import planning_sitemap_proposal as planning_sitemap_proposal_agent
from app.agents import planning_summary as planning_summary_agent
from app.agents import planning_visual_directions as planning_visual_directions_agent
from app.agents import planning_visual_review as planning_visual_review_agent
from app.agents import planning_website_direction as planning_website_direction_agent
from app.agents.planning_audit import Finding
from app.agents.planning_comparable_patterns import ComparableSiteSignal, PlanningComparablePatternsInput
from app.agents.planning_content_draft import (
    ContactInput as ContentDraftContactInput,
    PlanningContentDraftPageInput,
    PlanningContentSectionInput,
)
from app.agents.planning_recommendations import PlanningRecommendationsInput
from app.agents.planning_recommendations import ContactInput as RecommendationContactInput
from app.agents.planning_review_insights import PlanningReviewInsightsInput
from app.agents.planning_sitemap_proposal import PlanningSitemapProposalInput
from app.agents.planning_summary import PlanningSummaryInput
from app.agents.planning_visual_directions import PlanningVisualDirectionsInput
from app.agents.planning_visual_review import PlanningVisualReviewInput
from app.agents.planning_website_direction import ContactInput, PlanningWebsiteDirectionInput
from app.agents.review_intelligence import ThemeOutput
from app.agents.website_audit import WebsiteAuditOutput
from app.integrations.browser import PlanningAuditSignals, fetch_planning_audit_signals
from app.integrations.discovery import registry as discovery_registry
from app.integrations.discovery.base import DiscoveryCriteria, WebsiteStatus
from app.integrations.llm import LlmUnavailableError
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.discovery.models import DiscoveredBusiness
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import (
    JOB_CONTENT_DRAFT_GENERATE,
    JOB_PLANNING_ANALYSIS,
    JOB_PLANNING_COMPARABLE_ANALYSIS,
)
from app.modules.jobs.models import Job, JobStatus
from app.modules.leads.models import Lead
from app.modules.planning import handoff_sync
from app.modules.planning.models import (
    AssetStatus,
    ComparableResearchStatus,
    ContentDraftStatus,
    ContentPageStatus,
    ContentSource,
    LeadPlanning,
    LeadPlanningApprovedBrief,
    LeadPlanningAsset,
    LeadPlanningComparableSite,
    LeadPlanningContentPage,
    LeadPlanningContentSection,
    LeadPlanningRecommendation,
    LeadPlanningSitemapPage,
    PlanningAnalysisStep,
    PlanningStatus,
    RecommendationCategory,
    RecommendationSourceType,
    RecommendationStatus,
    SocialDataSource,
)
from app.modules.planning.schemas import (
    AssetRead,
    BuildBriefFactRead,
    BuildBriefRead,
    ContentPageRead,
    ContentSectionPreviewRead,
    CreateAssetRequest,
    CreateRecommendationRequest,
    CreateSitemapPageRequest,
    PlanningChecklistSummary,
    PlanningListItem,
    PlanningRead,
    PlanningSocialProfileRead,
    RecommendationRead,
    RegenerateContentSectionResponse,
    ReorderSitemapPagesRequest,
    SelectVisualDirectionRequest,
    SitemapPageProposalRead,
    UpdateAssetRequest,
    UpdateRecommendationRequest,
    UpdateSitemapPageRequest,
    UpdateSocialProfileRequest,
    VisualDirectionOptionRead,
)
from app.modules.projects.models import Project
from app.modules.review_intelligence import service as review_intelligence_service
from app.modules.sitemaps.models import PageType
from app.modules.stage_checklists import service as stage_checklists_service
from app.modules.website_audits import service as website_audits_service
from app.modules.website_audits.models import WebsiteAudit

# A small, controlled set — "present the candidate sites as references",
# never a long list. Up to this many raw provider results are examined
# per search to find that many usable (has-a-real-website) candidates.
MAX_COMPARABLE_CANDIDATES = 5
_COMPARABLE_SEARCH_RAW_LIMIT = 10


class NoWebsiteUrlError(Exception):
    """Raised by run_analysis when neither the request body nor the
    workspace's existing website_url has a URL to analyse — the route
    maps this to 400."""


class LeadNotFoundError(Exception):
    """Distinct from "no Planning workspace for this lead yet" (a
    legitimate None result) — the route maps this to 404."""


class NoApprovedBriefError(Exception):
    """Raised by create_project_from_planning when no Build Brief has
    been approved yet — the route maps this to 400."""


class NoVisualDirectionSelectedError(Exception):
    """Raised by select_visual_direction when neither `option_index` nor
    an existing selection is available to edit — the route maps this to
    400."""


def _get_lead(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
    return db.scalar(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Lead.id == lead_id)
        .options(joinedload(Lead.business))
    )


def _get_planning(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID) -> LeadPlanning | None:
    return db.scalar(
        select(LeadPlanning)
        .join(Lead, LeadPlanning.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, LeadPlanning.id == planning_id)
        .options(
            joinedload(LeadPlanning.website_audit),
            joinedload(LeadPlanning.lead).joinedload(Lead.business),
            joinedload(LeadPlanning.review_intelligence),
            selectinload(LeadPlanning.comparable_sites),
            selectinload(LeadPlanning.recommendations),
            selectinload(LeadPlanning.sitemap_pages),
            selectinload(LeadPlanning.assets),
            joinedload(LeadPlanning.approved_brief),
            selectinload(LeadPlanning.content_pages).selectinload(LeadPlanningContentPage.sections),
            selectinload(LeadPlanning.content_pages).joinedload(LeadPlanningContentPage.sitemap_page),
        )
    )


def _discovered_business_for_lead(db: Session, lead_id: uuid.UUID) -> DiscoveredBusiness | None:
    return db.scalar(select(DiscoveredBusiness).where(DiscoveredBusiness.imported_lead_id == lead_id))


def _build_social_profile_read(
    planning: LeadPlanning, discovered: DiscoveredBusiness | None
) -> PlanningSocialProfileRead:
    """
    The effective Social Presence view: whichever fields the operator (or
    a future Meta-enrichment job) has explicitly set on `planning` itself,
    falling back — for Instagram only, since no other source ever exists
    for Facebook — to the linked DiscoveredBusiness's Instagram fields
    (Discovery's own Brave-search-derived data, never a live fetch here).
    """
    if planning.instagram_source is not None:
        instagram = {
            "instagram_handle": planning.instagram_handle,
            "instagram_profile_url": planning.instagram_profile_url,
            "instagram_bio": planning.instagram_bio,
            "instagram_bio_link_url": planning.instagram_bio_link_url,
            "instagram_source": planning.instagram_source.value,
            "instagram_verified_at": planning.instagram_verified_at,
        }
    elif discovered is not None and discovered.instagram_handle:
        instagram = {
            "instagram_handle": discovered.instagram_handle,
            "instagram_profile_url": discovered.instagram_profile_url,
            "instagram_bio": discovered.instagram_bio,
            "instagram_bio_link_url": discovered.instagram_bio_link_url,
            "instagram_source": SocialDataSource.DISCOVERED_BUSINESS.value,
            "instagram_verified_at": None,
        }
    else:
        instagram = {
            "instagram_handle": None,
            "instagram_profile_url": None,
            "instagram_bio": None,
            "instagram_bio_link_url": None,
            "instagram_source": None,
            "instagram_verified_at": None,
        }

    if planning.facebook_source is not None:
        facebook = {
            "facebook_page_url": planning.facebook_page_url,
            "facebook_page_name": planning.facebook_page_name,
            "facebook_bio": planning.facebook_bio,
            "facebook_source": planning.facebook_source.value,
            "facebook_verified_at": planning.facebook_verified_at,
        }
    else:
        facebook = {
            "facebook_page_url": None,
            "facebook_page_name": None,
            "facebook_bio": None,
            "facebook_source": None,
            "facebook_verified_at": None,
        }

    has_any = bool(
        instagram["instagram_handle"] or instagram["instagram_profile_url"] or facebook["facebook_page_url"]
    )

    return PlanningSocialProfileRead(
        **instagram,
        **facebook,
        instagram_profile_image_url=discovered.instagram_profile_image_url if discovered else None,
        instagram_follower_count=discovered.instagram_follower_count if discovered else None,
        has_any=has_any,
    )


def _content_source_fingerprint(planning: LeadPlanning, sitemap_page: LeadPlanningSitemapPage) -> str:
    """A stable hash of everything a Content Draft page's copy actually
    depended on at approval time — the objective, accepted Keep/Improve/
    Add items, this page's own sitemap purpose/reason, and the selected
    visual direction. Recomputed fresh on every read and compared to
    what was stored at approval (service.approve_content_page) to
    surface `stale` — never used to change stored content itself."""
    accepted = sorted(
        f"{r.category.value}:{r.title}:{r.explanation}"
        for r in planning.recommendations
        if r.status == RecommendationStatus.ACCEPTED
    )
    payload = {
        "objective": planning.recommendations_objective,
        "accepted_recommendations": accepted,
        "page_purpose": sitemap_page.purpose,
        "page_reason": sitemap_page.reason,
        "visual_direction": planning.selected_visual_direction,
    }
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _to_read(db: Session, planning: LeadPlanning, lead: Lead | None = None) -> PlanningRead:
    data = PlanningRead.model_validate(planning)
    data.lead_business_name = (lead or planning.lead).business.name
    data.project_id = planning.approved_brief.project_id if planning.approved_brief else None
    audit = planning.website_audit
    if audit is not None:
        data.has_existing_site = audit.has_existing_site
        data.screenshot_desktop_base64 = audit.screenshot_desktop_base64
        data.screenshot_mobile_base64 = audit.screenshot_mobile_base64
        data.detected_technology = (audit.extended_signals or {}).get("generator_meta")
    # Only New Website Plan mode ever needs Social Presence — skip the
    # extra DiscoveredBusiness lookup entirely for Existing Website mode.
    if planning.website_audit_id is None:
        discovered = _discovered_business_for_lead(db, planning.lead_id)
        data.social_profile = _build_social_profile_read(planning, discovered)
    # content_pages is already populated by model_validate above (nested
    # from_attributes) — this just overlays the computed `stale` flag,
    # never touching the stored status/content.
    for content_page_read, content_page in zip(data.content_pages, planning.content_pages):
        if content_page.status == ContentPageStatus.APPROVED and content_page.approved_source_fingerprint:
            current = _content_source_fingerprint(planning, content_page.sitemap_page)
            content_page_read.stale = current != content_page.approved_source_fingerprint
    return data


def _to_list_item(planning: LeadPlanning, business: Business, has_screenshot: bool) -> PlanningListItem:
    return PlanningListItem(
        id=planning.id,
        lead_id=planning.lead_id,
        lead_business_name=business.name,
        website_url=planning.website_url,
        status=planning.status.value,
        comparable_research_status=planning.comparable_research_status.value if planning.comparable_research_status else None,
        content_draft_status=planning.content_draft_status.value if planning.content_draft_status else None,
        content_draft_progress_label=planning.content_draft_progress_label,
        project_id=planning.approved_brief.project_id if planning.approved_brief else None,
        created_at=planning.created_at,
        updated_at=planning.updated_at,
        analysed_at=planning.analysed_at,
        website_audit_id=planning.website_audit_id,
        has_screenshot=has_screenshot,
        lead_industry=business.industry,
        lead_suburb=business.suburb,
        lead_state=business.state,
        website_plan_generated_at=planning.website_plan_generated_at,
    )


def start_planning(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, lead_id: uuid.UUID) -> PlanningRead | None:
    """
    "Start Planning" — opens this lead's one Planning workspace,
    creating it if it doesn't exist yet. Never runs an audit and never
    creates a duplicate: `lead_id` is unique, so a second call for the
    same lead just returns the existing workspace untouched (no new
    activity log entry either — opening isn't an event worth logging
    again).
    """
    lead = _get_lead(db, workspace_id, lead_id)
    if lead is None:
        return None

    existing = db.scalar(select(LeadPlanning).where(LeadPlanning.lead_id == lead_id))
    if existing is not None:
        return _to_read(db, existing, lead)

    planning = LeadPlanning(
        lead_id=lead.id, website_url=lead.business.website_url, status=PlanningStatus.READY_TO_ANALYSE
    )
    db.add(planning)
    db.flush()
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="planning_started",
        summary=f"Started a Planning workspace for {lead.business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning, lead)


def _has_pending_analysis_job(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID) -> bool:
    """Guards against stacking a duplicate JOB_PLANNING_ANALYSIS job for
    the same workspace while one is already queued or running — found
    happening for real (repeated clicks while the status-transition bug
    above made the button look like it hadn't done anything)."""
    jobs = db.scalars(
        select(Job).where(
            Job.workspace_id == workspace_id,
            Job.job_type == JOB_PLANNING_ANALYSIS,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
    )
    return any(j.payload.get("planning_id") == str(planning_id) for j in jobs)


def run_analysis(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID, website_url: str | None
) -> PlanningRead | None:
    """
    "Analyse Website" — the explicit, separate trigger for the
    background pipeline (app.jobs.handlers / JOB_PLANNING_ANALYSIS).
    Distinct from start_planning: creating the workspace never runs an
    audit, only this does. Raises NoWebsiteUrlError if the workspace has
    no website_url yet and none was supplied; a supplied URL is saved
    onto the workspace before the job runs, so a retry or re-analyse
    doesn't need to re-enter it.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    resolved_url = website_url or planning.website_url
    if not resolved_url:
        raise NoWebsiteUrlError("This workspace has no website URL yet — enter one to analyse.")
    planning.website_url = resolved_url
    # Flips to ANALYSING immediately, not just once the job runner claims
    # it — this is what the frontend's polling and the "Analyse Website"
    # empty-state check both key off. Leaving this at READY_TO_ANALYSE
    # (a real bug fixed here) meant the button never visibly changed
    # state after being clicked, inviting repeated clicks that each
    # enqueued another duplicate job — see _has_pending_analysis_job
    # below for the belt-and-suspenders guard against that.
    planning.status = PlanningStatus.ANALYSING
    db.flush()

    if not _has_pending_analysis_job(db, workspace_id, planning.id):
        jobs_service.enqueue(
            db,
            workspace_id=workspace_id,
            job_type=JOB_PLANNING_ANALYSIS,
            payload={"planning_id": str(planning.id)},
            actor_id=actor_id,
        )
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_analysis_requested",
        summary=f"Started a Planning website analysis for {resolved_url}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def get_planning_for_lead(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> PlanningRead | None:
    """None means "no Planning workspace started for this lead yet" — a
    legitimate state, not a 404. Raises LeadNotFoundError if the lead
    itself doesn't exist/isn't in this workspace."""
    lead = _get_lead(db, workspace_id, lead_id)
    if lead is None:
        raise LeadNotFoundError()
    planning = db.scalar(
        select(LeadPlanning)
        .where(LeadPlanning.lead_id == lead_id)
        .options(
            joinedload(LeadPlanning.website_audit),
            joinedload(LeadPlanning.review_intelligence),
            selectinload(LeadPlanning.comparable_sites),
        )
    )
    return _to_read(db, planning, lead) if planning is not None else None


def list_planning_workspace(
    db: Session, workspace_id: uuid.UUID, *, include_transferred: bool = False
) -> list[PlanningListItem]:
    """
    Default view excludes items already transferred to a Project
    (`approved_brief.project_id is not None`) — the same "hide once
    handed off, keep reachable via history" convention as Discovery's
    imported rows. `include_transferred=True` is the history filter.
    """
    # The screenshot-presence check is a plain SQL boolean expression
    # (WebsiteAudit.screenshot_desktop_base64.isnot(None)) — Postgres
    # evaluates NULL-ness without detoasting the column, so this never
    # pulls the actual (large) base64 payload across the wire for every
    # row, unlike loading the WebsiteAudit relationship itself would.
    rows = db.execute(
        select(LeadPlanning, Business, WebsiteAudit.screenshot_desktop_base64.isnot(None))
        .join(Lead, LeadPlanning.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .outerjoin(WebsiteAudit, LeadPlanning.website_audit_id == WebsiteAudit.id)
        .where(Business.workspace_id == workspace_id)
        .options(joinedload(LeadPlanning.approved_brief))
        .order_by(LeadPlanning.created_at.desc())
    ).all()
    items = [_to_list_item(p, business, has_screenshot) for p, business, has_screenshot in rows]
    if not include_transferred:
        items = [i for i in items if i.project_id is None]
    return items


def list_planning_checklist_summaries(db: Session, workspace_id: uuid.UUID) -> list[PlanningChecklistSummary]:
    """
    One summary per Planning item, for the Planning grid's compact
    progress display — mirrors Clients' own list_checklist_summaries
    (checklists/service.py): loop the existing per-item read
    (get_planning_checklist, which also seeds default tasks the first
    time) server-side, in one call, rather than the frontend issuing an
    N+1 fetch per card. Counts REQUIRED tasks only, same "compact glance
    metric shouldn't be diluted by optional improvements" convention.
    """
    planning_ids = db.scalars(
        select(LeadPlanning.id)
        .join(Lead, LeadPlanning.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
    ).all()

    out: list[PlanningChecklistSummary] = []
    for planning_id in planning_ids:
        checklist = stage_checklists_service.get_planning_checklist(db, workspace_id, planning_id)
        if checklist is None:
            continue
        progress = checklist.progress.required
        out.append(
            PlanningChecklistSummary(
                planning_id=planning_id,
                completed=progress.completed,
                total=progress.total,
                pct=progress.pct,
                next_item_title=checklist.next_item.title if checklist.next_item else None,
            )
        )
    return out


def get_planning_screenshot(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID) -> bytes | None:
    """Decodes and returns the stored desktop screenshot's raw PNG bytes
    for the dedicated thumbnail route (GET /api/v1/planning/{id}/screenshot).
    A narrow, workspace-scoped query against just the one column needed —
    not _get_planning's full eager-loaded graph, which would pull in
    every other large relationship just to read one column."""
    encoded = db.scalar(
        select(WebsiteAudit.screenshot_desktop_base64)
        .join(LeadPlanning, LeadPlanning.website_audit_id == WebsiteAudit.id)
        .join(Lead, LeadPlanning.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, LeadPlanning.id == planning_id)
    )
    if not encoded:
        return None
    return base64.b64decode(encoded)


def get_planning(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    return _to_read(db, planning)


def update_planning(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, updates: dict
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    if "website_summary" in updates:
        planning.website_summary = updates["website_summary"]
    if "operator_notes" in updates:
        planning.operator_notes = updates["operator_notes"]
    if "review_summary" in updates:
        planning.review_summary = updates["review_summary"]
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def delete_planning(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID) -> bool | None:
    """
    Removes this Planning item and its backing WebsiteAudit (findings,
    signals, screenshots) — "safe remove": the Lead itself, its Client
    (if any), and any Project are never touched, and the Lead can be
    analysed again later to create a brand new Planning item. Returns
    None if the item doesn't exist (route maps to 404), True once
    removed.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    lead_id = planning.lead_id
    website_url = planning.website_url
    audit_id = planning.website_audit_id

    db.delete(planning)
    if audit_id is not None:
        audit = db.get(WebsiteAudit, audit_id)
        if audit is not None:
            db.delete(audit)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead_id,
        action="planning_removed",
        summary=f"Removed a Planning analysis for {website_url}",
    )
    db.commit()
    return True


def _build_direction_narrative(planning: LeadPlanning, approved_brief: LeadPlanningApprovedBrief) -> str:
    """The human-readable Planning narrative carried to a Project's `build_direction` — at
    handoff, and again on every re-sync (planning/handoff_sync.py), so both build it the same way."""
    direction_parts = []
    if planning.website_summary:
        source = f" ({planning.website_url})" if planning.website_url else ""
        direction_parts.append(f"From Planning{source}:\n{planning.website_summary}")
    if planning.key_points:
        points = "\n".join(f"- {p['message']}" for p in planning.key_points)
        direction_parts.append(f"Key points:\n{points}")
    # New Website Plan mode (no audit) — carries the synthesized plan
    # forward the same way key_points does for an audited site.
    if planning.recommended_objective:
        direction_parts.append(f"Recommended objective:\n{planning.recommended_objective}")
    if planning.priority_pages:
        pages = "\n".join(f"- {p['title']}: {p['purpose']}" for p in planning.priority_pages)
        direction_parts.append(f"Priority pages:\n{pages}")
    for label, field in (
        ("Content priorities", planning.content_priorities),
        ("Contact priorities", planning.contact_priorities),
        ("Visual priorities", planning.visual_priorities),
        ("Open questions", planning.open_questions),
    ):
        if field:
            direction_parts.append(f"{label}:\n" + "\n".join(f"- {item}" for item in field))
    if planning.comparable_research_opportunities:
        opportunities = "\n".join(f"- {o['opportunity']}" for o in planning.comparable_research_opportunities)
        direction_parts.append(f"Opportunities from comparable-site research:\n{opportunities}")
    if planning.operator_notes:
        direction_parts.append(f"Operator notes:\n{planning.operator_notes}")

    # Approved Build Brief — confirmed facts, accepted Keep/Improve/Add
    # (with evidence), assets, and open questions, all carried forward as
    # the full human-readable narrative even though the structured pieces
    # above (Sitemap/CreativeDirectionBrief/DesignBrief) also now exist.
    if approved_brief.objective:
        direction_parts.append(f"Build Brief objective:\n{approved_brief.objective}")
    if approved_brief.confirmed_facts:
        facts = "\n".join(f"- {f['fact']} (source: {f['source']})" for f in approved_brief.confirmed_facts)
        direction_parts.append(f"Confirmed facts:\n{facts}")
    if approved_brief.accepted_recommendations:
        by_category: dict[str, list[str]] = {}
        for r in approved_brief.accepted_recommendations:
            line = r["title"] + (f" — {r['source_evidence']}" if r.get("source_evidence") else "")
            by_category.setdefault(r["category"], []).append(line)
        for category in ("keep", "improve", "add"):
            if category in by_category:
                items = "\n".join(f"- {line}" for line in by_category[category])
                direction_parts.append(f"{category.capitalize()}:\n{items}")
    if approved_brief.assets_snapshot:
        assets = "\n".join(f"- {a['label']}: {a['status']}" for a in approved_brief.assets_snapshot)
        direction_parts.append(f"Assets checklist:\n{assets}")
    if approved_brief.open_questions_snapshot:
        questions = "\n".join(f"- {q}" for q in approved_brief.open_questions_snapshot)
        direction_parts.append(f"Open questions:\n{questions}")

    if approved_brief.content_draft_snapshot:
        page_lines = "\n".join(
            f"- {p['title']}: {len(p.get('sections', []))} section(s) approved"
            for p in approved_brief.content_draft_snapshot
        )
        direction_parts.append(f"Content Draft (approved pages):\n{page_lines}")
        content_questions = [
            f"{p['title']}: {note}"
            for p in approved_brief.content_draft_snapshot
            for section in p.get("sections", [])
            for note in section.get("needs_confirmation_notes", [])
        ]
        if content_questions:
            direction_parts.append(
                "Content Draft — needs confirmation:\n" + "\n".join(f"- {q}" for q in content_questions)
            )
    return "\n\n".join(direction_parts)


def create_project_from_planning(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID):
    """
    Creates a Lead-owned prospect Project from this Planning item's
    approved Build Brief — no Client, no Lead status change, no
    SalesOpportunity (docs/05_DECISIONS.md: creating a speculative
    project must not convert the Lead). The operator converts to a
    Client separately and explicitly, whenever they choose
    (clients.service.create_client), which reassigns this same Project
    rather than creating a second one. Requires an approved Build Brief
    (raises NoApprovedBriefError otherwise — the route maps this to
    400). Idempotent: once the approved brief's project_id is set, a
    repeated call short-circuits to that same Project instead of
    creating a duplicate.
    """
    from app.modules.design_briefs import service as design_briefs_service
    from app.modules.projects import service as projects_service
    from app.modules.projects.schemas import ProjectCreate, ProjectUpdate

    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    approved_brief = planning.approved_brief
    if approved_brief is None:
        raise NoApprovedBriefError("Approve the Build Brief before creating a project.")

    if approved_brief.project_id is not None:
        return projects_service.get_project(db, workspace_id, approved_brief.project_id)

    project_read = projects_service.create_project(
        db,
        workspace_id,
        actor_id,
        ProjectCreate(lead_id=planning.lead_id, name=f"{planning.lead.business.name} Website"),
    )
    project = db.get(Project, project_read.id)
    if project is None:
        return None

    handoff_sync.seed_sitemap_and_creative_direction(db, project.id, approved_brief)
    handoff_sync.apply_to_design_brief(
        db,
        project.id,
        handoff_sync.derive_design_brief_fields(approved_brief.assets_snapshot, approved_brief.content_draft_snapshot),
    )
    # Planning's helper above creates the DesignBrief (so the normal
    # "pre-fill a brand-new brief" path never runs); top up the business
    # fields from the lead's records now. Runs after it and only fills
    # empty fields, so Planning's own copy is never displaced.
    design_briefs_service.prefill_project_brief(db, project)

    narrative = _build_direction_narrative(planning, approved_brief)
    # Only into an empty build direction: a project the operator already
    # started may hold their own, and a re-run must not overwrite either.
    if narrative and not project.build_direction:
        projects_service.update_project(db, workspace_id, actor_id, project.id, ProjectUpdate(build_direction=narrative))

    approved_brief.handoff_baseline = handoff_sync.initial_baseline(approved_brief, narrative)
    approved_brief.project_id = project.id
    db.commit()
    return projects_service.get_project(db, workspace_id, project.id)


def run_review_insights(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    "Run Review Insights" — the Google Review Insights action inside
    Planning (docs/05_DECISIONS.md). Synchronous, matching the existing
    precedent for this data source (review_intelligence.run_review_intelligence
    is already synchronous despite calling Google Places + an LLM),
    rather than Planning's own async/job-queued pattern used for
    "Analyse Website".

    Refreshes this Lead's review intelligence (modules/review_intelligence,
    lead-scoped — reused entirely, not duplicated) for the Reputation
    Snapshot, Customer Themes, and Neutral Review Summary. Only when
    there are recurring themes to work with does it also run the new
    synthesis agent (agents/planning_review_insights.py) against this
    workspace's own audit findings, for Website Opportunities, FAQ
    Opportunities, and Review-to-Website Gaps — a degrade-gracefully LLM
    failure there still keeps the reputation snapshot/themes/summary
    already saved, it just leaves the synthesis fields as they were.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    review_read = review_intelligence_service.run_review_intelligence_for_lead(
        db, workspace_id, actor_id, planning.lead_id
    )
    if review_read is None:
        return _to_read(db, planning)

    planning.review_intelligence_id = review_read.id
    planning.review_summary = review_read.review_summary
    planning.review_insights_generated_at = datetime.now(timezone.utc)

    if review_read.positive_review_themes or review_read.negative_review_themes:
        audit_findings = [planning_audit_agent.Finding.model_validate(f) for f in planning.key_points]
        try:
            insights_result = planning_review_insights_agent.run(
                PlanningReviewInsightsInput(
                    business_name=planning.lead.business.name,
                    positive_review_themes=[t.model_dump() for t in review_read.positive_review_themes],
                    negative_review_themes=[t.model_dump() for t in review_read.negative_review_themes],
                    audit_findings=audit_findings,
                )
            )
            planning.review_website_opportunities = [
                o.model_dump(mode="json") for o in insights_result.output.website_opportunities
            ]
            planning.review_faq_opportunities = [
                f.model_dump(mode="json") for f in insights_result.output.faq_opportunities
            ]
            planning.review_website_gaps = [
                g.model_dump(mode="json") for g in insights_result.output.review_website_gaps
            ]
        except LlmUnavailableError:
            pass

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_review_insights_generated",
        summary=f"Generated Google Review Insights for {planning.lead.business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def _no_llm_summary_fallback(exc: LlmUnavailableError) -> str:
    return f"{exc} The key points below are drawn directly from the audit findings."


def _derive_audit_output(signals: PlanningAuditSignals) -> WebsiteAuditOutput:
    """Same has_existing_site/mobile_friendly shape as agents/website_audit.py,
    derived from the richer PlanningAuditSignals capture rather than a second
    page load."""
    if signals.error:
        return WebsiteAuditOutput(has_existing_site=True, audit_error=signals.error)
    mobile_friendly = None
    if signals.viewport_meta_present is not None and signals.mobile_overflow is not None:
        mobile_friendly = bool(signals.viewport_meta_present) and not signals.mobile_overflow
    return WebsiteAuditOutput(
        has_existing_site=True,
        mobile_friendly=mobile_friendly,
        https=signals.https,
        load_time_ms=signals.load_time_ms,
        title=signals.title,
        meta_description=signals.meta_description,
        viewport_meta_present=signals.viewport_meta_present,
    )


def _set_step(db: Session, planning: LeadPlanning, step: PlanningAnalysisStep) -> None:
    """
    Records a real checkpoint the frontend's progress list polls for —
    committed immediately (not batched with the step's own work) so a
    concurrent GET sees it the moment this phase actually starts.
    """
    planning.current_step = step
    db.commit()


def run_analysis_job(db: Session, planning_id: uuid.UUID) -> dict:
    """
    app.jobs.handlers's JOB_PLANNING_ANALYSIS body — the background half
    of "Analyse Website". Runs the full pipeline (unchanged from this
    session's earlier work): one real browser fetch, deterministic
    findings, the screenshot-grounded visual review, and the Website
    Summary paragraph — each LLM step degrading gracefully (still
    completes, marked needs_review) rather than failing the whole run
    when no LLM is configured. A genuine exception marks the item failed
    and re-raises, so it also shows up as a failed Job for operators
    watching the queue.

    `current_step` is set at each real phase boundary (see
    PlanningAnalysisStep) purely so the frontend can show honest
    progress instead of a timed guess — it never influences what the
    pipeline actually does.
    """
    planning = db.get(LeadPlanning, planning_id)
    if planning is None:
        raise RuntimeError(f"Planning item {planning_id} not found")

    planning.status = PlanningStatus.ANALYSING
    _set_step(db, planning, PlanningAnalysisStep.STRUCTURE)

    try:
        signals = asyncio.run(
            fetch_planning_audit_signals(
                planning.website_url,
                on_progress=lambda: _set_step(db, planning, PlanningAnalysisStep.MOBILE),
            )
        )
        _set_step(db, planning, PlanningAnalysisStep.TECHNICAL)
        findings_result = planning_audit_agent.run(signals)
        findings = [f.model_dump() for f in findings_result.output.findings]

        _set_step(db, planning, PlanningAnalysisStep.VISUAL)
        visual_findings: list[dict] = []
        visual_available = True
        try:
            visual_result = planning_visual_review_agent.run(
                PlanningVisualReviewInput(
                    screenshot_desktop_base64=signals.screenshot_desktop_base64,
                    screenshot_mobile_base64=signals.screenshot_mobile_base64,
                )
            )
            visual_findings = [f.model_dump() for f in visual_result.output.findings]
        except LlmUnavailableError:
            visual_available = False

        all_findings = findings + visual_findings
        audit_output = _derive_audit_output(signals)
        extended_signals = signals.__dict__.copy()
        extended_signals.pop("screenshot_desktop_base64", None)
        extended_signals.pop("screenshot_mobile_base64", None)
        audit = website_audits_service.create_planning_audit(
            db,
            lead_id=planning.lead_id,
            output=audit_output,
            findings=all_findings,
            extended_signals=extended_signals,
            screenshot_desktop_base64=signals.screenshot_desktop_base64,
            screenshot_mobile_base64=signals.screenshot_mobile_base64,
        )

        _set_step(db, planning, PlanningAnalysisStep.SUMMARY)
        summary_available = True
        lead = db.get(Lead, planning.lead_id)
        try:
            summary_result = planning_summary_agent.run(
                PlanningSummaryInput(
                    business_name=lead.business.name,
                    has_website=True,
                    findings=findings_result.output.findings
                    + [planning_audit_agent.Finding.model_validate(f) for f in visual_findings],
                )
            )
            website_summary = summary_result.output.website_summary
        except LlmUnavailableError as exc:
            summary_available = False
            website_summary = _no_llm_summary_fallback(exc)

        planning.website_audit_id = audit.id
        planning.website_summary = website_summary
        planning.key_points = all_findings
        planning.analysed_at = datetime.now(timezone.utc)
        needs_review = (
            bool(signals.error)
            or findings_result.flagged_for_review
            or not visual_available
            or not summary_available
        )
        planning.status = PlanningStatus.NEEDS_REVIEW if needs_review else PlanningStatus.COMPLETED
        planning.current_step = None
        db.commit()
        return {"planning_id": str(planning.id), "status": planning.status.value}
    except Exception as exc:
        db.rollback()
        planning = db.get(LeadPlanning, planning_id)
        planning.status = PlanningStatus.FAILED
        planning.current_step = None
        planning.error_message = str(exc)
        db.commit()
        raise


def _no_llm_website_plan_fallback(business: Business, exc: LlmUnavailableError) -> str:
    facts = [f"Business: {business.name}"]
    if business.industry:
        facts.append(f"Category: {business.industry}")
    location = ", ".join(filter(None, [business.suburb, business.state]))
    if location:
        facts.append(f"Location: {location}")
    if business.phone:
        facts.append(f"Phone: {business.phone}")
    if business.email:
        facts.append(f"Email: {business.email}")
    return (
        f"{exc} No plan could be generated — here is what's on file instead:\n" + "\n".join(facts)
    )


def generate_website_plan(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    "Generate Website Plan" — New Website Plan mode's core action, for a
    Lead with no website to audit (docs/05_DECISIONS.md). Synchronous,
    same precedent as run_review_insights: this calls an LLM but does no
    slow browser fetch, so it doesn't need Planning's job-queued
    "analysing" pattern. Builds agents/planning_website_direction.py's
    input entirely from already-verified facts — the business record,
    its named contacts, this Lead's Google review themes (whatever
    Review Insights already has on file — never triggers a fresh Google
    Places lookup itself, that stays its own action), and this
    workspace's Social Presence (Instagram/Facebook) — whatever an
    operator has confirmed, or otherwise whatever is already stored on
    this Lead's originating DiscoveredBusiness if it came through
    Discovery (a read of already-fetched fields, never a new
    Instagram/Facebook fetch).

    Degrades gracefully exactly like run_analysis_job's Website Summary
    step: an unavailable LLM still completes with a plain factual
    recap, marked needs_review, rather than failing outright.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    business = planning.lead.business
    contacts = [ContactInput(name=c.name, role=c.role) for c in business.contacts]
    location = ", ".join(filter(None, [business.suburb, business.state])) or None

    review = planning.review_intelligence
    positive_themes = [ThemeOutput.model_validate(t) for t in (review.positive_review_themes if review else [])]
    negative_themes = [ThemeOutput.model_validate(t) for t in (review.negative_review_themes if review else [])]

    discovered = _discovered_business_for_lead(db, planning.lead_id)
    social = _build_social_profile_read(planning, discovered)

    agent_input = PlanningWebsiteDirectionInput(
        business_name=business.name,
        business_category=business.industry,
        location=location,
        phone=business.phone,
        email=business.email,
        contacts=contacts,
        operator_notes=planning.operator_notes,
        positive_review_themes=positive_themes,
        negative_review_themes=negative_themes,
        instagram_handle=social.instagram_handle,
        instagram_bio=social.instagram_bio,
        instagram_profile_url=social.instagram_profile_url,
        instagram_bio_link_url=social.instagram_bio_link_url,
        instagram_follower_count=social.instagram_follower_count,
        has_instagram_profile_image=social.instagram_profile_image_url is not None,
        facebook_page_url=social.facebook_page_url,
        facebook_page_name=social.facebook_page_name,
        facebook_bio=social.facebook_bio,
    )

    try:
        result = planning_website_direction_agent.run(agent_input)
        output = result.output
        planning.recommended_objective = output.recommended_objective
        planning.priority_pages = [p.model_dump() for p in output.priority_pages]
        planning.content_priorities = output.content_priorities
        planning.contact_priorities = output.contact_priorities
        planning.visual_priorities = output.visual_priorities
        planning.open_questions = output.open_questions
        planning.website_summary = output.website_summary
        planning.status = PlanningStatus.COMPLETED
    except LlmUnavailableError as exc:
        planning.website_summary = _no_llm_website_plan_fallback(business, exc)
        planning.status = PlanningStatus.NEEDS_REVIEW

    planning.website_plan_generated_at = datetime.now(timezone.utc)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_website_plan_generated",
        summary=f"Generated a Website Plan for {business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


_INSTAGRAM_FIELDS = ("instagram_handle", "instagram_profile_url", "instagram_bio", "instagram_bio_link_url")
_FACEBOOK_FIELDS = ("facebook_page_url", "facebook_page_name", "facebook_bio")


def update_social_profile(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, data: UpdateSocialProfileRequest
) -> PlanningRead | None:
    """
    Operator edits to Social Presence. Editing any field for a platform
    "locks in" that whole platform as operator_entered: the platform's
    *currently effective* view (including anything still only inherited
    from a linked DiscoveredBusiness) is materialized onto this row
    first, so a field the operator didn't touch is preserved rather than
    silently cleared, then the submitted fields are overlaid.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    submitted = data.model_dump(exclude_unset=True)
    touched_instagram = any(f in submitted for f in _INSTAGRAM_FIELDS)
    touched_facebook = any(f in submitted for f in _FACEBOOK_FIELDS)

    if touched_instagram:
        discovered = _discovered_business_for_lead(db, planning.lead_id)
        current = _build_social_profile_read(planning, discovered)
        planning.instagram_handle = current.instagram_handle
        planning.instagram_profile_url = current.instagram_profile_url
        planning.instagram_bio = current.instagram_bio
        planning.instagram_bio_link_url = current.instagram_bio_link_url
        for field in _INSTAGRAM_FIELDS:
            if field in submitted:
                setattr(planning, field, submitted[field])
        planning.instagram_source = SocialDataSource.OPERATOR_ENTERED
        planning.instagram_verified_at = datetime.now(timezone.utc)

    if touched_facebook:
        for field in _FACEBOOK_FIELDS:
            if field in submitted:
                setattr(planning, field, submitted[field])
        planning.facebook_source = SocialDataSource.OPERATOR_ENTERED
        planning.facebook_verified_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


# --- Build Brief: Keep / Improve / Add --------------------------------------


def _next_order_index(items: list) -> int:
    return (max((item.order_index for item in items), default=-1)) + 1


def _existing_titles(items: list) -> set[str]:
    return {item.title.strip().lower() for item in items}


def generate_recommendations(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    Build Brief's "Keep / Improve / Add" (docs/05_DECISIONS.md).
    Mode-agnostic: grounds `improve` in real audit findings when this
    workspace has them (Existing Website mode), and never invents an
    "existing website problem" when it doesn't (New Website Plan mode).
    Regeneration only ever APPENDS rows whose title doesn't already
    match an existing one (any status) — it never edits or removes a
    row, so accepting/dismissing/editing is never silently undone.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    business = planning.lead.business
    contacts = [RecommendationContactInput(name=c.name, role=c.role) for c in business.contacts]
    location = ", ".join(filter(None, [business.suburb, business.state])) or None

    review = planning.review_intelligence
    positive_themes = [ThemeOutput.model_validate(t) for t in (review.positive_review_themes if review else [])]
    negative_themes = [ThemeOutput.model_validate(t) for t in (review.negative_review_themes if review else [])]

    discovered = _discovered_business_for_lead(db, planning.lead_id)
    social = _build_social_profile_read(planning, discovered)

    has_existing_website = planning.website_audit_id is not None
    audit_findings = [Finding.model_validate(p) for p in planning.key_points] if has_existing_website else []

    agent_input = PlanningRecommendationsInput(
        business_name=business.name,
        business_category=business.industry,
        location=location,
        phone=business.phone,
        email=business.email,
        contacts=contacts,
        operator_notes=planning.operator_notes,
        has_existing_website=has_existing_website,
        website_summary=planning.website_summary,
        audit_findings=audit_findings,
        positive_review_themes=positive_themes,
        negative_review_themes=negative_themes,
        instagram_handle=social.instagram_handle,
        instagram_bio=social.instagram_bio,
        has_instagram_profile_image=social.instagram_profile_image_url is not None,
        facebook_page_url=social.facebook_page_url,
        facebook_bio=social.facebook_bio,
        comparable_patterns=[p["pattern"] for p in planning.comparable_research_patterns],
        comparable_opportunities=[o["opportunity"] for o in planning.comparable_research_opportunities],
    )

    result = planning_recommendations_agent.run(agent_input)
    output = result.output
    planning.recommendations_objective = output.website_objective

    existing_titles = _existing_titles(planning.recommendations)
    order = _next_order_index(planning.recommendations)
    for category, items in (
        (RecommendationCategory.KEEP, output.keep),
        (RecommendationCategory.IMPROVE, output.improve),
        (RecommendationCategory.ADD, output.add),
    ):
        for item in items:
            if item.title.strip().lower() in existing_titles:
                continue
            try:
                source_type = RecommendationSourceType(item.source_type)
            except ValueError:
                source_type = RecommendationSourceType.BUSINESS_INFO
            db.add(
                LeadPlanningRecommendation(
                    lead_planning_id=planning.id,
                    category=category,
                    title=item.title,
                    explanation=item.explanation,
                    source_type=source_type,
                    source_evidence=item.source_evidence,
                    status=RecommendationStatus.PROPOSED,
                    order_index=order,
                )
            )
            existing_titles.add(item.title.strip().lower())
            order += 1

    planning.recommendations_generated_at = datetime.now(timezone.utc)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_recommendations_generated",
        summary=f"Generated Keep/Improve/Add recommendations for {business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def update_recommendation(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, recommendation_id: uuid.UUID,
    data: UpdateRecommendationRequest,
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    rec = next((r for r in planning.recommendations if r.id == recommendation_id), None)
    if rec is None:
        return None

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(rec, field, RecommendationStatus(value) if field == "status" else value)

    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def add_recommendation(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, data: CreateRecommendationRequest
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    db.add(
        LeadPlanningRecommendation(
            lead_planning_id=planning.id,
            category=RecommendationCategory(data.category),
            title=data.title,
            explanation=data.explanation,
            source_type=RecommendationSourceType.OPERATOR,
            source_evidence=data.source_evidence,
            status=RecommendationStatus.ACCEPTED,
            order_index=_next_order_index(planning.recommendations),
        )
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def delete_recommendation(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, recommendation_id: uuid.UUID
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    rec = next((r for r in planning.recommendations if r.id == recommendation_id), None)
    if rec is None:
        return None
    db.delete(rec)
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


# --- Build Brief: Proposed Sitemap and Homepage Outline ---------------------


def generate_sitemap_proposal(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    Build Brief's "Proposed Sitemap and Homepage Outline". Mode-agnostic.
    `page_type` reuses modules/sitemaps.models.PageType directly.
    Regeneration only ever APPENDS pages whose title doesn't already
    match an existing one.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    business = planning.lead.business
    discovered = _discovered_business_for_lead(db, planning.lead_id)
    social = _build_social_profile_read(planning, discovered)
    review = planning.review_intelligence

    accepted_add_items = [
        r.title for r in planning.recommendations
        if r.category == RecommendationCategory.ADD and r.status == RecommendationStatus.ACCEPTED
    ]
    audit_area_summary = [
        f"{p['area']}: {p['message']}" for p in planning.key_points if p.get("severity") in ("critical", "high")
    ][:5]

    agent_input = PlanningSitemapProposalInput(
        business_name=business.name,
        business_category=business.industry,
        website_objective=planning.recommendations_objective,
        accepted_add_items=accepted_add_items,
        has_existing_website=planning.website_audit_id is not None,
        audit_area_summary=audit_area_summary,
        has_social_presence=social.has_any,
        has_positive_reviews=bool(review and review.positive_review_themes),
    )

    result = planning_sitemap_proposal_agent.run(agent_input)
    output = result.output

    existing_titles = _existing_titles(planning.sitemap_pages)
    order = _next_order_index(planning.sitemap_pages)
    for page in output.pages:
        if page.title.strip().lower() in existing_titles:
            continue
        db.add(
            LeadPlanningSitemapPage(
                lead_planning_id=planning.id,
                order_index=order,
                title=page.title,
                page_type=PageType(page.page_type),
                purpose=page.purpose,
                reason=page.reason,
                key_sections=page.key_sections,
                needs_confirmation=page.needs_confirmation,
            )
        )
        existing_titles.add(page.title.strip().lower())
        order += 1

    planning.sitemap_proposal_generated_at = datetime.now(timezone.utc)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_sitemap_proposal_generated",
        summary=f"Generated a proposed sitemap for {business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def update_sitemap_page(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, page_id: uuid.UUID, data: UpdateSitemapPageRequest
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    page = next((p for p in planning.sitemap_pages if p.id == page_id), None)
    if page is None:
        return None

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(page, field, PageType(value) if field == "page_type" else value)

    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def add_sitemap_page(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, data: CreateSitemapPageRequest
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    db.add(
        LeadPlanningSitemapPage(
            lead_planning_id=planning.id,
            order_index=_next_order_index(planning.sitemap_pages),
            title=data.title,
            page_type=PageType(data.page_type),
            purpose=data.purpose,
            reason=data.reason,
            key_sections=data.key_sections,
            needs_confirmation=data.needs_confirmation,
        )
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def delete_sitemap_page(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, page_id: uuid.UUID) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    page = next((p for p in planning.sitemap_pages if p.id == page_id), None)
    if page is None:
        return None
    db.delete(page)
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def reorder_sitemap_pages(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, data: ReorderSitemapPagesRequest
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    by_id = {p.id: p for p in planning.sitemap_pages}
    for item in data.pages:
        page = by_id.get(item.id)
        if page is not None:
            page.order_index = item.order_index
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


# --- Build Brief: Visual Direction Choices ----------------------------------


def generate_visual_directions(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    Build Brief's "Visual Direction Choices" — 2-3 concise, distinct
    options in one call (see agents/planning_visual_directions.py for why
    this is a separate, lighter agent rather than 2-3 Creative Director
    calls). Replaces the candidate pool wholesale; never touches
    `selected_visual_direction` once an operator has chosen one.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    business = planning.lead.business
    discovered = _discovered_business_for_lead(db, planning.lead_id)
    social = _build_social_profile_read(planning, discovered)
    review = planning.review_intelligence

    agent_input = PlanningVisualDirectionsInput(
        business_name=business.name,
        business_category=business.industry,
        website_objective=planning.recommendations_objective,
        positive_review_themes=[t["theme"] for t in (review.positive_review_themes if review else [])],
        has_instagram_profile_image=social.instagram_profile_image_url is not None,
        instagram_bio=social.instagram_bio,
        comparable_patterns=[p["pattern"] for p in planning.comparable_research_patterns],
        operator_notes=planning.operator_notes,
    )

    result = planning_visual_directions_agent.run(agent_input)
    planning.visual_direction_options = [opt.model_dump() for opt in result.output.options]
    planning.visual_directions_generated_at = datetime.now(timezone.utc)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_visual_directions_generated",
        summary=f"Generated visual direction choices for {business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def select_visual_direction(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, data: SelectVisualDirectionRequest
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    if data.option_index is not None:
        options = planning.visual_direction_options
        if data.option_index < 0 or data.option_index >= len(options):
            raise NoVisualDirectionSelectedError(f"No visual direction option at index {data.option_index}.")
        base = dict(options[data.option_index])
    elif planning.selected_visual_direction is not None:
        base = dict(planning.selected_visual_direction)
    else:
        raise NoVisualDirectionSelectedError("No visual direction has been selected yet — pass option_index.")

    overrides = data.model_dump(exclude_unset=True, exclude={"option_index"})
    base.update(overrides)
    planning.selected_visual_direction = base

    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


# --- Build Brief: Assets Checklist ------------------------------------------

_PORTFOLIO_PAGE_TYPES = (PageType.PORTFOLIO, PageType.PRODUCTS, PageType.PRODUCT_DETAIL)


def generate_assets_checklist(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    Seeds the Assets Checklist from real records the first time it's
    opened; every later call only ever ADDS newly-relevant rows (e.g. a
    proposed portfolio/products page implying a gallery-images need) —
    an operator's status/note edit on an existing row is never touched.
    A publicly-visible social image is always seeded REFERENCE_ONLY,
    never READY_TO_USE.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    business = planning.lead.business
    discovered = _discovered_business_for_lead(db, planning.lead_id)
    social = _build_social_profile_read(planning, discovered)
    existing_categories = {a.category for a in planning.assets}

    has_contact = bool(business.phone or business.email or business.suburb or business.state)
    standard_rows = [
        ("logo", "Logo / brand assets", AssetStatus.MISSING, None),
        (
            "photos",
            "Business / service photographs",
            AssetStatus.REFERENCE_ONLY if social.instagram_profile_image_url else AssetStatus.MISSING,
            "Instagram profile image on file — reference only, needs owner approval to use." if social.instagram_profile_image_url else None,
        ),
        ("service_descriptions", "Service descriptions", AssetStatus.MISSING, None),
        (
            "contact_details",
            "Contact & location details",
            AssetStatus.READY_TO_USE if has_contact else AssetStatus.MISSING,
            None,
        ),
        (
            "booking_destination",
            "Booking / enquiry destination",
            AssetStatus.READY_TO_USE if (business.phone or business.email) else AssetStatus.MISSING,
            None,
        ),
    ]
    for category, label, status, note in standard_rows:
        if category not in existing_categories:
            db.add(
                LeadPlanningAsset(
                    lead_planning_id=planning.id, category=category, label=label, status=status, note=note
                )
            )
            existing_categories.add(category)

    if "portfolio_images" not in existing_categories and any(
        p.page_type in _PORTFOLIO_PAGE_TYPES for p in planning.sitemap_pages
    ):
        db.add(
            LeadPlanningAsset(
                lead_planning_id=planning.id,
                category="portfolio_images",
                label="Portfolio / gallery images",
                status=AssetStatus.MISSING,
                note="Needed for the proposed portfolio/products page(s).",
            )
        )

    planning.assets_checklist_generated_at = datetime.now(timezone.utc)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_assets_checklist_refreshed",
        summary=f"Refreshed the assets checklist for {business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def update_asset(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, asset_id: uuid.UUID, data: UpdateAssetRequest
) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    asset = next((a for a in planning.assets if a.id == asset_id), None)
    if asset is None:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(asset, field, AssetStatus(value) if field == "status" else value)
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def add_asset(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, data: CreateAssetRequest) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    db.add(
        LeadPlanningAsset(
            lead_planning_id=planning.id,
            category=data.category,
            label=data.label,
            status=AssetStatus(data.status),
            note=data.note,
        )
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


# --- Build Brief: compiled preview + approval -------------------------------


def _confirmed_facts(planning: LeadPlanning, social: PlanningSocialProfileRead) -> list[BuildBriefFactRead]:
    business = planning.lead.business
    facts: list[BuildBriefFactRead] = [BuildBriefFactRead(fact=f"Business name: {business.name}", source="Business record")]
    if business.industry:
        facts.append(BuildBriefFactRead(fact=f"Category: {business.industry}", source="Business record"))
    location = ", ".join(filter(None, [business.suburb, business.state]))
    if location:
        facts.append(BuildBriefFactRead(fact=f"Location: {location}", source="Business record"))
    if business.phone:
        facts.append(BuildBriefFactRead(fact=f"Phone: {business.phone}", source="Business record"))
    if business.email:
        facts.append(BuildBriefFactRead(fact=f"Email: {business.email}", source="Business record"))
    if social.instagram_handle:
        facts.append(BuildBriefFactRead(fact=f"Instagram: @{social.instagram_handle}", source="Social Presence"))
    if social.facebook_page_url:
        facts.append(BuildBriefFactRead(fact=f"Facebook Page: {social.facebook_page_url}", source="Social Presence"))
    review = planning.review_intelligence
    if review and review.google_rating is not None:
        facts.append(
            BuildBriefFactRead(
                fact=f"Google rating: {review.google_rating}★ ({review.google_review_count or 0} reviews)",
                source="Google Review Insights",
            )
        )
    return facts


def _open_questions(planning: LeadPlanning) -> list[str]:
    items = list(planning.open_questions)
    seen = {q.strip().lower() for q in items}
    for page in planning.sitemap_pages:
        if page.needs_confirmation:
            q = f"Confirm content for the proposed '{page.title}' page."
            if q.strip().lower() not in seen:
                items.append(q)
                seen.add(q.strip().lower())
    for asset in planning.assets:
        if asset.status == AssetStatus.MISSING:
            q = f"Missing asset: {asset.label}."
            if q.strip().lower() not in seen:
                items.append(q)
                seen.add(q.strip().lower())
    return items


def compute_build_brief(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID) -> BuildBriefRead | None:
    """The live, always-current compiled Build Brief — never the frozen
    approved snapshot. See BuildBriefRead's own docstring."""
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    discovered = _discovered_business_for_lead(db, planning.lead_id)
    social = _build_social_profile_read(planning, discovered)

    accepted = [
        RecommendationRead.model_validate(r) for r in planning.recommendations if r.status == RecommendationStatus.ACCEPTED
    ]
    sitemap = [SitemapPageProposalRead.model_validate(p) for p in planning.sitemap_pages]
    visual_direction = (
        VisualDirectionOptionRead.model_validate(planning.selected_visual_direction)
        if planning.selected_visual_direction
        else None
    )
    assets = [AssetRead.model_validate(a) for a in planning.assets]

    brief = planning.approved_brief
    return BuildBriefRead(
        objective=planning.recommendations_objective,
        confirmed_facts=_confirmed_facts(planning, social),
        accepted_recommendations=accepted,
        sitemap=sitemap,
        visual_direction=visual_direction,
        content_priorities=planning.content_priorities,
        contact_priorities=planning.contact_priorities,
        visual_priorities=planning.visual_priorities,
        assets=assets,
        open_questions=_open_questions(planning),
        is_approved=brief is not None,
        approved_at=brief.approved_at if brief else None,
        approved_by_user_id=brief.approved_by_user_id if brief else None,
        project_id=brief.project_id if brief else None,
        sync_conflicts=list(brief.sync_conflicts or []) if brief else [],
    )


def approve_build_brief(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> BuildBriefRead | None:
    """Snapshots the current compute_build_brief output into
    LeadPlanningApprovedBrief. Freely re-approvable (upsert). Once a
    Project has consumed the brief (approved_brief.project_id set), a
    re-approval also pushes what changed since to that Project — the
    Project's own edits are kept and flagged, not overwritten (see
    planning/handoff_sync.py) — so later Planning edits and content
    approvals reach it instead of being dropped."""
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    existing = planning.approved_brief
    # What the last handoff/sync was built from — only needed if this
    # re-approval has a Project to sync (below), and read before the
    # snapshot fields are overwritten.
    previous_state = None
    if existing is not None and existing.project_id is not None:
        previous_state = handoff_sync.derive_state(
            existing.assets_snapshot,
            existing.content_draft_snapshot,
            existing.sitemap_snapshot,
            existing.visual_direction_snapshot,
        )

    brief = compute_build_brief(db, workspace_id, planning_id)
    if existing is None:
        existing = LeadPlanningApprovedBrief(lead_planning_id=planning.id)
        db.add(existing)

    existing.objective = brief.objective or ""
    existing.confirmed_facts = [f.model_dump() for f in brief.confirmed_facts]
    existing.accepted_recommendations = [r.model_dump(mode="json") for r in brief.accepted_recommendations]
    existing.sitemap_snapshot = [p.model_dump(mode="json") for p in brief.sitemap]
    existing.visual_direction_snapshot = brief.visual_direction.model_dump() if brief.visual_direction else None
    existing.content_priorities = brief.content_priorities
    existing.contact_priorities = brief.contact_priorities
    existing.visual_priorities = brief.visual_priorities
    existing.assets_snapshot = [a.model_dump(mode="json") for a in brief.assets]
    existing.open_questions_snapshot = brief.open_questions
    existing.content_draft_snapshot = [
        {
            "sitemap_page_id": str(page.sitemap_page_id),
            "title": page.sitemap_page.title,
            "seo_title": page.seo_title,
            "seo_meta_description": page.seo_meta_description,
            "sections": [
                {"section_type": s.section_type, "content": s.content, "needs_confirmation_notes": s.needs_confirmation_notes}
                for s in page.sections
            ],
        }
        for page in planning.content_pages
        if page.status == ContentPageStatus.APPROVED
    ]
    existing.approved_by_user_id = actor_id
    existing.approved_at = datetime.now(timezone.utc)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_build_brief_approved",
        summary=f"Approved the Build Brief for {planning.lead.business.name}",
    )
    if previous_state is not None:
        _sync_handed_off_project(db, workspace_id, actor_id, planning, existing, previous_state)
    db.commit()
    return compute_build_brief(db, workspace_id, planning_id)


def _sync_handed_off_project(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    planning: LeadPlanning,
    approved_brief: LeadPlanningApprovedBrief,
    previous_state: dict,
) -> None:
    project = db.get(Project, approved_brief.project_id)
    if project is None:
        return
    # A handoff that predates the stored baseline: what the last snapshot
    # handed over is exactly what the Project was seeded with, except the
    # narrative, which can't be reconstructed — so the merge treats a
    # non-empty Project build direction as the Project's own.
    baseline = approved_brief.handoff_baseline or {**previous_state, "build_direction": ""}
    applied, flagged = handoff_sync.sync_to_project(
        db,
        project,
        approved_brief,
        narrative=_build_direction_narrative(planning, approved_brief),
        baseline=baseline,
    )
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="planning_changes_synced",
        summary=(
            f"Synced Planning changes to the project ({applied} applied"
            + (f", {flagged} kept as the project's own edits" if flagged else "")
            + ")"
        ),
    )


def _hostname(url: str) -> str | None:
    try:
        host = urlparse(url).netloc.lower()
    except ValueError:
        return None
    return host[4:] if host.startswith("www.") else host or None


class NoComparableSitesIncludedError(Exception):
    """Raised by run_comparable_analysis when every candidate has been
    excluded (or none were ever found) — the route maps this to 400."""


def search_comparable_sites(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    "Research Comparable Websites" (search step) — reuses Discovery's
    own provider adapters directly (app.integrations.discovery.registry),
    bypassing the CRM discovery pipeline entirely: no DiscoveredBusiness
    row is created, nothing is enqueued for research/audit/scoring, and
    nothing surfaces in the Review Queue or Leads. Only Google Places or
    Brave Search are ever used here — never Instagram Search Discovery.

    Synchronous, same as a normal Discovery search today (one provider
    call). A re-search replaces the whole previous batch (delete then
    insert), same "re-run updates in place" precedent as run_analysis.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    business = planning.lead.business
    location = ", ".join(filter(None, [business.suburb, business.state])) or None
    provider_name = discovery_registry.default_provider()
    provider = discovery_registry.get_provider(provider_name)

    # ProviderUnavailableError (e.g. no API key configured) is left to
    # propagate — the route maps it to a 503, same shape as an
    # unavailable LLM but under its own, honestly-named exception rather
    # than borrowed terminology.
    page = provider.discover(
        DiscoveryCriteria(location=location, industry=business.industry, limit=_COMPARABLE_SEARCH_RAW_LIMIT),
        db=db,
    )

    own_hostname = _hostname(business.website_url) if business.website_url else None
    seen_hostnames: set[str] = set()
    candidates = []
    for result in page.results:
        if result.website_status != WebsiteStatus.FOUND or not result.website_url:
            continue
        hostname = _hostname(result.website_url)
        if not hostname or hostname == own_hostname or hostname in seen_hostnames:
            continue
        seen_hostnames.add(hostname)
        candidates.append(result)
        if len(candidates) >= MAX_COMPARABLE_CANDIDATES:
            break

    # Re-search replaces the previous batch entirely.
    for site in list(planning.comparable_sites):
        db.delete(site)
    db.flush()

    for result in candidates:
        db.add(
            LeadPlanningComparableSite(
                lead_planning_id=planning.id,
                business_name=result.name,
                website_url=result.website_url,
                business_category=result.business_category or result.industry,
                location_text=", ".join(filter(None, [result.suburb, result.state])) or None,
                source_provider=provider_name,
                source_evidence=result.raw_snippet,
            )
        )

    planning.comparable_research_status = (
        ComparableResearchStatus.READY_FOR_REVIEW if candidates else planning.comparable_research_status
    )
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_comparable_search",
        summary=f"Found {len(candidates)} comparable website(s) for {business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def update_comparable_site(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, site_id: uuid.UUID, included: bool
) -> PlanningRead | None:
    """Toggling a candidate in/out before analysis — the operator's own
    curation step. Returns None (route 404s) if the site doesn't belong
    to this workspace's Planning item."""
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    site = next((s for s in planning.comparable_sites if s.id == site_id), None)
    if site is None:
        return None
    site.included = included
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def run_comparable_analysis(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    "Analyse included sites" — enqueues JOB_PLANNING_COMPARABLE_ANALYSIS.
    Raises NoComparableSitesIncludedError if there's nothing to analyse
    (no search run yet, or everything's been excluded) — the route maps
    this to 400, same shape as run_analysis's NoWebsiteUrlError.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    included = [s for s in planning.comparable_sites if s.included]
    if not included:
        raise NoComparableSitesIncludedError(
            "No comparable sites to analyse — search first, and make sure at least one is included."
        )

    planning.comparable_research_status = ComparableResearchStatus.ANALYSING
    db.flush()
    jobs_service.enqueue(
        db,
        workspace_id=workspace_id,
        job_type=JOB_PLANNING_COMPARABLE_ANALYSIS,
        payload={"planning_id": str(planning.id)},
        actor_id=actor_id,
    )
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_comparable_analysis_requested",
        summary=f"Started comparable-website analysis for {planning.lead.business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def run_comparable_analysis_job(db: Session, planning_id: uuid.UUID) -> dict:
    """
    app.jobs.handlers's JOB_PLANNING_COMPARABLE_ANALYSIS body. Fetches
    each included candidate's public homepage using the exact same
    fetch_planning_audit_signals Existing-Website mode uses — but
    screenshots are discarded immediately and never persisted for a
    comparable site (never store/show competitor imagery). One site
    failing to fetch is marked fetch_ok=False and skipped; it never
    fails the whole batch. The synthesis agent then runs once over
    every successfully-fetched site — see agents/planning_comparable_patterns.py
    for the "public reference research only" guardrails.
    """
    planning = db.get(LeadPlanning, planning_id)
    if planning is None:
        raise RuntimeError(f"Planning item {planning_id} not found")

    included = [s for s in planning.comparable_sites if s.included]
    try:
        signals: list[ComparableSiteSignal] = []
        for site in included:
            try:
                fetched = asyncio.run(fetch_planning_audit_signals(site.website_url))
                site.fetch_ok = not bool(fetched.error)
                if fetched.error:
                    continue
                signals.append(
                    ComparableSiteSignal(
                        business_name=site.business_name,
                        website_url=site.website_url,
                        title=fetched.title,
                        meta_description=fetched.meta_description,
                        h1_count=fetched.h1_count,
                        contact_cta_present=fetched.contact_cta_present,
                        canonical_present=fetched.canonical_present,
                        robots_txt_reachable=fetched.robots_txt_reachable,
                        sitemap_xml_reachable=fetched.sitemap_xml_reachable,
                        mobile_overflow=fetched.mobile_overflow,
                        viewport_meta_present=fetched.viewport_meta_present,
                        load_time_ms=fetched.load_time_ms,
                        has_local_business_schema=fetched.has_local_business_schema,
                        postal_address=fetched.postal_address,
                        contact_phone=fetched.contact_phone,
                    )
                )
            except Exception:
                site.fetch_ok = False
        db.commit()

        business = planning.lead.business
        try:
            result = planning_comparable_patterns_agent.run(
                PlanningComparablePatternsInput(
                    business_name=business.name, business_category=business.industry, sites=signals
                )
            )
            planning.comparable_research_patterns = [p.model_dump() for p in result.output.patterns]
            planning.comparable_research_opportunities = [o.model_dump() for o in result.output.opportunities]
            planning.comparable_research_status = (
                ComparableResearchStatus.COMPLETED if signals else ComparableResearchStatus.NEEDS_REVIEW
            )
        except LlmUnavailableError as exc:
            planning.comparable_research_status = ComparableResearchStatus.NEEDS_REVIEW
            planning.comparable_research_error = str(exc)

        planning.comparable_research_generated_at = datetime.now(timezone.utc)
        db.commit()
        return {"planning_id": str(planning.id), "status": planning.comparable_research_status.value}
    except Exception as exc:
        db.rollback()
        planning = db.get(LeadPlanning, planning_id)
        planning.comparable_research_status = ComparableResearchStatus.FAILED
        planning.comparable_research_error = str(exc)
        db.commit()
        raise


# --- Content Draft -----------------------------------------------------


class NoSitemapPagesError(Exception):
    """Raised by run_content_draft when the workspace has no proposed
    sitemap pages yet — the route maps this to 400. Content is organised
    by page, so there's nothing to draft until Build Brief's sitemap
    proposal has at least one page."""


def _has_pending_content_draft_job(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID) -> bool:
    """Same guard as _has_pending_analysis_job, for JOB_CONTENT_DRAFT_GENERATE."""
    jobs = db.scalars(
        select(Job).where(
            Job.workspace_id == workspace_id,
            Job.job_type == JOB_CONTENT_DRAFT_GENERATE,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
    )
    return any(j.payload.get("planning_id") == str(planning_id) for j in jobs)


def _content_draft_shared_kwargs(db: Session, planning: LeadPlanning) -> dict:
    """Everything Content Draft's agent needs that ISN'T specific to one
    page — the same Build Brief inputs generate_recommendations/
    generate_sitemap_proposal already assemble, plus the selected visual
    direction's tone. `approved_testimonials` is always empty: no
    mechanism exists yet in Planning for an operator to mark a review
    excerpt approved for testimonial use (see agents/planning_content_draft.py's
    docstring) — the prompt is explicit that an empty list means no
    testimonials section is ever drafted, which is the safe default."""
    business = planning.lead.business
    contacts = [ContentDraftContactInput(name=c.name, role=c.role) for c in business.contacts]
    accepted = [r for r in planning.recommendations if r.status == RecommendationStatus.ACCEPTED]
    review = planning.review_intelligence
    discovered = _discovered_business_for_lead(db, planning.lead_id)
    social = _build_social_profile_read(planning, discovered)
    visual = planning.selected_visual_direction or {}
    return dict(
        business_name=business.name,
        business_category=business.industry,
        location=", ".join(filter(None, [business.suburb, business.state])) or None,
        phone=business.phone,
        email=business.email,
        contacts=contacts,
        operator_notes=planning.operator_notes,
        website_objective=planning.recommendations_objective,
        accepted_keep=[r.title for r in accepted if r.category == RecommendationCategory.KEEP],
        accepted_improve=[r.title for r in accepted if r.category == RecommendationCategory.IMPROVE],
        accepted_add=[r.title for r in accepted if r.category == RecommendationCategory.ADD],
        positive_review_themes=[t["theme"] for t in (review.positive_review_themes if review else [])],
        negative_review_themes=[t["theme"] for t in (review.negative_review_themes if review else [])],
        approved_testimonials=[],
        instagram_bio=social.instagram_bio,
        facebook_bio=social.facebook_bio,
        visual_character=visual.get("character"),
        visual_tone_notes=", ".join(filter(None, [visual.get("typography"), visual.get("layout")])) or None,
        comparable_patterns=[p["pattern"] for p in planning.comparable_research_patterns],
    )


def _content_draft_page_input(
    db: Session, planning: LeadPlanning, sitemap_page: LeadPlanningSitemapPage
) -> PlanningContentDraftPageInput:
    kwargs = _content_draft_shared_kwargs(db, planning)
    return PlanningContentDraftPageInput(
        **kwargs,
        page_title=sitemap_page.title,
        page_type=sitemap_page.page_type.value,
        page_purpose=sitemap_page.purpose,
        page_reason=sitemap_page.reason,
        page_key_sections=sitemap_page.key_sections,
        page_needs_confirmation=sitemap_page.needs_confirmation,
    )


def run_content_draft(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID
) -> PlanningRead | None:
    """
    "Generate Content Draft" — the request-time half. Job-queued (see
    JOB_CONTENT_DRAFT_GENERATE / run_content_draft_job below) since
    drafting real copy for every planned page is real, potentially slow
    LLM work — same precedent as "Analyse Website".
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    if not planning.sitemap_pages:
        raise NoSitemapPagesError("Generate a proposed sitemap in Build Brief before drafting content.")

    planning.content_draft_status = ContentDraftStatus.GENERATING
    planning.content_draft_progress_label = None
    planning.content_draft_error = None
    db.flush()

    if not _has_pending_content_draft_job(db, workspace_id, planning.id):
        jobs_service.enqueue(
            db,
            workspace_id=workspace_id,
            job_type=JOB_CONTENT_DRAFT_GENERATE,
            payload={"planning_id": str(planning.id)},
            actor_id=actor_id,
        )
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=planning.lead_id,
        action="planning_content_draft_requested",
        summary=f"Started a Content Draft generation for {planning.lead.business.name}",
    )
    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def run_content_draft_job(db: Session, planning_id: uuid.UUID) -> dict:
    """
    JOB_CONTENT_DRAFT_GENERATE's body. Drafts real copy for every
    proposed sitemap page that isn't already EDITED/APPROVED — append-
    only at page granularity, the same rule every other Build Brief
    generator uses at row granularity, so an operator's edit or approval
    is never silently undone by a later "Generate Content Draft" click.
    `content_draft_progress_label` is set once per page and committed
    immediately (same "a concurrent poll sees it mid-run" contract as
    _set_step), since the number of pages varies per plan. A global
    LlmUnavailableError (the router/config itself is unavailable, not a
    one-off) stops the loop rather than repeating an identical failure
    once per remaining page — existing pages from a prior run are left
    exactly as they were.
    """
    planning = db.get(LeadPlanning, planning_id)
    if planning is None:
        raise RuntimeError(f"Planning item {planning_id} not found")

    pages_by_sitemap_id = {cp.sitemap_page_id: cp for cp in planning.content_pages}
    sitemap_pages = sorted(planning.sitemap_pages, key=lambda p: p.order_index)
    to_generate = [
        p
        for p in sitemap_pages
        if pages_by_sitemap_id.get(p.id) is None or pages_by_sitemap_id[p.id].status == ContentPageStatus.DRAFT
    ]
    total = len(to_generate)

    try:
        for i, sitemap_page in enumerate(to_generate):
            planning.content_draft_progress_label = f"Drafting {sitemap_page.title} ({i + 1} of {total})"
            db.commit()

            agent_input = _content_draft_page_input(db, planning, sitemap_page)
            output = planning_content_draft_agent.run_page(agent_input).output

            content_page = pages_by_sitemap_id.get(sitemap_page.id)
            if content_page is None:
                content_page = LeadPlanningContentPage(lead_planning_id=planning.id, sitemap_page_id=sitemap_page.id)
                db.add(content_page)
                db.flush()
                pages_by_sitemap_id[sitemap_page.id] = content_page
            content_page.seo_title = output.seo_title
            content_page.seo_meta_description = output.seo_meta_description
            content_page.status = ContentPageStatus.DRAFT
            # A full replace is safe here: this branch is only ever
            # reached for a page with no edited/approved content yet.
            for section in list(content_page.sections):
                db.delete(section)
            db.flush()
            for order_index, section in enumerate(output.sections):
                db.add(
                    LeadPlanningContentSection(
                        content_page_id=content_page.id,
                        order_index=order_index,
                        section_type=section.section_type,
                        content=section.content,
                        needs_confirmation_notes=section.needs_confirmation,
                        source=ContentSource.GENERATED,
                    )
                )
            db.commit()

        planning = db.get(LeadPlanning, planning_id)
        planning.content_draft_status = ContentDraftStatus.COMPLETED
        planning.content_draft_progress_label = None
        planning.content_draft_generated_at = datetime.now(timezone.utc)
        db.commit()
        return {"planning_id": str(planning.id), "status": planning.content_draft_status.value}
    except LlmUnavailableError as exc:
        db.rollback()
        planning = db.get(LeadPlanning, planning_id)
        planning.content_draft_status = ContentDraftStatus.NEEDS_REVIEW
        planning.content_draft_error = str(exc)
        planning.content_draft_progress_label = None
        db.commit()
        return {"planning_id": str(planning.id), "status": planning.content_draft_status.value}
    except Exception as exc:
        db.rollback()
        planning = db.get(LeadPlanning, planning_id)
        planning.content_draft_status = ContentDraftStatus.FAILED
        planning.content_draft_error = str(exc)
        planning.content_draft_progress_label = None
        db.commit()
        raise


def _find_content_page_and_section(
    planning: LeadPlanning, page_id: uuid.UUID, section_id: uuid.UUID
) -> tuple[LeadPlanningContentPage, LeadPlanningContentSection] | tuple[None, None]:
    page = next((p for p in planning.content_pages if p.id == page_id), None)
    if page is None:
        return None, None
    section = next((s for s in page.sections if s.id == section_id), None)
    if section is None:
        return None, None
    return page, section


def update_content_section(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, page_id: uuid.UUID, section_id: uuid.UUID,
    content: dict,
) -> PlanningRead | None:
    """A direct operator edit. Reverts an APPROVED page to EDITED (same
    edit-reverts-approval convention as CreativeDirectionBrief/Sitemap/
    DesignBrief) — never silently keeps a stale "approved" label on
    content that's since changed."""
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    page, section = _find_content_page_and_section(planning, page_id, section_id)
    if page is None:
        return None

    section.content = content
    section.source = ContentSource.OPERATOR_EDITED
    if page.status in (ContentPageStatus.APPROVED, ContentPageStatus.DRAFT):
        page.status = ContentPageStatus.EDITED

    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def update_content_page_seo(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, page_id: uuid.UUID,
    seo_title: str | None, seo_meta_description: str | None,
) -> PlanningRead | None:
    """A direct operator edit to the page's proposed SEO title/meta
    description — same edit-reverts-approval convention as
    update_content_section."""
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    page = next((p for p in planning.content_pages if p.id == page_id), None)
    if page is None:
        return None

    page.seo_title = seo_title
    page.seo_meta_description = seo_meta_description
    if page.status in (ContentPageStatus.APPROVED, ContentPageStatus.DRAFT):
        page.status = ContentPageStatus.EDITED

    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def regenerate_content_section(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, page_id: uuid.UUID, section_id: uuid.UUID,
) -> RegenerateContentSectionResponse | None:
    """
    Regenerating a still-untouched section (source=GENERATED) on a page
    that isn't APPROVED replaces it immediately — the cheap, common
    "keep iterating before anyone's invested edits" case. Regenerating
    anything valuable (an operator-edited section, or any section on an
    APPROVED page) instead returns a PREVIEW — nothing persisted — that
    the operator must explicitly apply (apply_content_section_preview):
    "preview replacement text before applying it," never a silent
    overwrite.
    """
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    page, section = _find_content_page_and_section(planning, page_id, section_id)
    if page is None:
        return None

    agent_input = PlanningContentSectionInput(
        **_content_draft_shared_kwargs(db, planning),
        page_title=page.sitemap_page.title,
        page_type=page.sitemap_page.page_type.value,
        page_purpose=page.sitemap_page.purpose,
        page_reason=page.sitemap_page.reason,
        page_key_sections=page.sitemap_page.key_sections,
        page_needs_confirmation=page.sitemap_page.needs_confirmation,
        target_section_type=section.section_type,
    )
    draft = planning_content_draft_agent.run_section(agent_input).output

    safe_to_replace = section.source == ContentSource.GENERATED and page.status != ContentPageStatus.APPROVED
    if safe_to_replace:
        section.content = draft.content
        section.needs_confirmation_notes = draft.needs_confirmation
        section.source = ContentSource.GENERATED
        db.commit()
        db.refresh(planning)
        return RegenerateContentSectionResponse(is_preview=False, planning=_to_read(db, planning))

    return RegenerateContentSectionResponse(
        is_preview=True,
        preview=ContentSectionPreviewRead(
            section_id=section.id,
            candidate_content=draft.content,
            candidate_needs_confirmation_notes=draft.needs_confirmation,
        ),
    )


def apply_content_section_preview(
    db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID, page_id: uuid.UUID, section_id: uuid.UUID,
    content: dict, needs_confirmation_notes: list[str],
) -> PlanningRead | None:
    """Persists a previously-returned regenerate preview. Counts as a
    fresh AI replacement (source=GENERATED, not an edit) — but since it
    deliberately replaces something an operator had edited or approved,
    it reverts an APPROVED page to EDITED the same as a direct edit
    would."""
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    page, section = _find_content_page_and_section(planning, page_id, section_id)
    if page is None:
        return None

    section.content = content
    section.needs_confirmation_notes = needs_confirmation_notes
    section.source = ContentSource.GENERATED
    if page.status == ContentPageStatus.APPROVED:
        page.status = ContentPageStatus.EDITED

    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)


def approve_content_page(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID, page_id: uuid.UUID,
) -> PlanningRead | None:
    """Approves one Content Draft page and stores the fingerprint of
    everything its copy currently depends on — see
    _content_source_fingerprint. Re-approving (e.g. after an edit) just
    recomputes and overwrites the fingerprint."""
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    page = next((p for p in planning.content_pages if p.id == page_id), None)
    if page is None:
        return None

    page.status = ContentPageStatus.APPROVED
    page.approved_by_user_id = actor_id
    page.approved_at = datetime.now(timezone.utc)
    page.approved_source_fingerprint = _content_source_fingerprint(planning, page.sitemap_page)

    db.commit()
    db.refresh(planning)
    return _to_read(db, planning)
