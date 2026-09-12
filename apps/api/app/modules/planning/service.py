import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents import planning_audit as planning_audit_agent
from app.agents import planning_review_insights as planning_review_insights_agent
from app.agents import planning_summary as planning_summary_agent
from app.agents import planning_visual_review as planning_visual_review_agent
from app.agents.planning_review_insights import PlanningReviewInsightsInput
from app.agents.planning_summary import PlanningSummaryInput
from app.agents.planning_visual_review import PlanningVisualReviewInput
from app.agents.website_audit import WebsiteAuditOutput
from app.integrations.browser import PlanningAuditSignals, fetch_planning_audit_signals
from app.integrations.llm import LlmUnavailableError
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import JOB_PLANNING_ANALYSIS
from app.modules.jobs.models import Job, JobStatus
from app.modules.leads.models import Lead
from app.modules.planning.models import LeadPlanning, PlanningStatus
from app.modules.planning.schemas import PlanningListItem, PlanningRead
from app.modules.projects.models import Project
from app.modules.review_intelligence import service as review_intelligence_service
from app.modules.website_audits import service as website_audits_service
from app.modules.website_audits.models import WebsiteAudit


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
        .options(joinedload(LeadPlanning.website_audit), joinedload(LeadPlanning.review_intelligence))
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
        direction_parts.append(f"From Planning analysis ({planning.website_url}):\n{planning.website_summary}")
    if planning.key_points:
        points = "\n".join(f"- {p['message']}" for p in planning.key_points)
        direction_parts.append(f"Key points:\n{points}")
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
    """
    planning = db.get(LeadPlanning, planning_id)
    if planning is None:
        raise RuntimeError(f"Planning item {planning_id} not found")

    planning.status = PlanningStatus.ANALYSING
    db.commit()

    try:
        signals = asyncio.run(fetch_planning_audit_signals(planning.website_url))
        findings_result = planning_audit_agent.run(signals)
        findings = [f.model_dump() for f in findings_result.output.findings]

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
        db.commit()
        return {"planning_id": str(planning.id), "status": planning.status.value}
    except Exception as exc:
        db.rollback()
        planning = db.get(LeadPlanning, planning_id)
        planning.status = PlanningStatus.FAILED
        planning.error_message = str(exc)
        db.commit()
        raise
