import asyncio
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.agents import planning_audit as planning_audit_agent
from app.agents import planning_comparable_patterns as planning_comparable_patterns_agent
from app.agents import planning_review_insights as planning_review_insights_agent
from app.agents import planning_summary as planning_summary_agent
from app.agents import planning_visual_review as planning_visual_review_agent
from app.agents import planning_website_direction as planning_website_direction_agent
from app.agents.planning_comparable_patterns import ComparableSiteSignal, PlanningComparablePatternsInput
from app.agents.planning_review_insights import PlanningReviewInsightsInput
from app.agents.planning_summary import PlanningSummaryInput
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
from app.modules.jobs.job_types import JOB_PLANNING_ANALYSIS, JOB_PLANNING_COMPARABLE_ANALYSIS
from app.modules.jobs.models import Job, JobStatus
from app.modules.leads.models import Lead
from app.modules.planning.models import (
    ComparableResearchStatus,
    LeadPlanning,
    LeadPlanningComparableSite,
    PlanningAnalysisStep,
    PlanningStatus,
)
from app.modules.planning.schemas import PlanningListItem, PlanningRead
from app.modules.projects.models import Project
from app.modules.review_intelligence import service as review_intelligence_service
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
        )
    )


def _to_read(planning: LeadPlanning, lead: Lead | None = None) -> PlanningRead:
    data = PlanningRead.model_validate(planning)
    data.lead_business_name = (lead or planning.lead).business.name
    audit = planning.website_audit
    if audit is not None:
        data.has_existing_site = audit.has_existing_site
        data.screenshot_desktop_base64 = audit.screenshot_desktop_base64
        data.screenshot_mobile_base64 = audit.screenshot_mobile_base64
        data.detected_technology = (audit.extended_signals or {}).get("generator_meta")
    return data


def _to_list_item(planning: LeadPlanning, business_name: str) -> PlanningListItem:
    return PlanningListItem(
        id=planning.id,
        lead_id=planning.lead_id,
        lead_business_name=business_name,
        website_url=planning.website_url,
        status=planning.status.value,
        created_at=planning.created_at,
        analysed_at=planning.analysed_at,
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
        return _to_read(existing, lead)

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
    return _to_read(planning, lead)


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
    return _to_read(planning)


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
    return _to_read(planning, lead) if planning is not None else None


def list_planning_workspace(db: Session, workspace_id: uuid.UUID) -> list[PlanningListItem]:
    rows = db.execute(
        select(LeadPlanning, Business.name)
        .join(Lead, LeadPlanning.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .order_by(LeadPlanning.created_at.desc())
    ).all()
    return [_to_list_item(p, name) for p, name in rows]


def get_planning(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID) -> PlanningRead | None:
    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None
    return _to_read(planning)


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
    return _to_read(planning)


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


def create_project_from_planning(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, planning_id: uuid.UUID):
    """
    Converts this Planning item's Lead into a Client + Project via the
    existing, unchanged lead-conversion path (clients.service.create_client
    with from_lead_id) — reused entirely, not duplicated — then seeds the
    new Project's existing `build_direction` field with this Planning
    run's summary and key points. Only ever called when the operator
    explicitly clicks "Create Project".
    """
    from app.modules.clients import service as clients_service
    from app.modules.clients.schemas import ClientCreate
    from app.modules.projects import service as projects_service
    from app.modules.projects.schemas import ProjectUpdate

    planning = _get_planning(db, workspace_id, planning_id)
    if planning is None:
        return None

    clients_service.create_client(db, workspace_id, actor_id, ClientCreate(from_lead_id=planning.lead_id))
    project = db.scalar(
        select(Project).where(Project.source_lead_id == planning.lead_id).order_by(Project.created_at.desc())
    )
    if project is None:
        return None

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
    if direction_parts:
        projects_service.update_project(
            db, workspace_id, actor_id, project.id, ProjectUpdate(build_direction="\n\n".join(direction_parts))
        )
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
        return _to_read(planning)

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
    return _to_read(planning)


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
    Places lookup itself, that stays its own action), and the
    Instagram bio/handle already stored on this Lead's originating
    DiscoveredBusiness, if it came through Discovery (a read of an
    already-fetched field, never a new Instagram fetch).

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

    discovered = db.scalar(select(DiscoveredBusiness).where(DiscoveredBusiness.imported_lead_id == planning.lead_id))

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
        instagram_handle=discovered.instagram_handle if discovered else None,
        instagram_bio=discovered.instagram_bio if discovered else None,
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
    return _to_read(planning)


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
    return _to_read(planning)


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
    return _to_read(planning)


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
    return _to_read(planning)


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
