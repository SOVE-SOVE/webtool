"""
Computes the ranked "Do This Next" queue for a workspace (phase 7 part
2, task 1). Each candidate action is scored on four independent factors
— urgency, opportunity, deadline, pipeline value — each normalized to
0-100, then combined into one `priority_score` so wildly different
kinds of work (an overdue follow-up vs. a failed deployment vs. a big
proposal gone quiet) can share a single ranked list.

This is deliberately a *sibling* to dashboard.service.get_overview's
`needs_attention`, not a replacement: the dashboard list is "everything
currently open, computed live, always up to date"; this is "the
morning's prioritized top-of-queue", persisted as a `DailyActionRun` so
notifications (modules/notifications) can diff today's run against
what's already been surfaced instead of re-deriving it, and so a run
can be looked back at after the fact. The two draw on the same
underlying tables and will legitimately raise overlapping items — that
duplication is the cost of one being a live status board and the other
being a scored, historical queue.
"""

import dataclasses
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.action_engine.models import ActionKind, ActionQueueItem, DailyActionRun
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.deployments.models import Deployment
from app.modules.design_briefs.models import BriefStatus, DesignBrief
from app.modules.design_briefs.schemas import BriefRead
from app.modules.leads.models import Lead, LeadPriority, LeadStatus
from app.modules.meetings.models import Meeting, MeetingStatus
from app.modules.outreach.models import FollowUp, FollowUpStatus
from app.modules.projects.models import Project, ProjectStage
from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity
from app.modules.websites.models import Website

# How long a HIGH-priority lead gets before "hasn't been contacted"
# starts counting against it — a lead created ten minutes ago isn't
# actionably late yet.
HOT_LEAD_GRACE_PERIOD = timedelta(hours=4)
MEETING_APPROACHING_WINDOW = timedelta(hours=48)
PROPOSAL_STALE_THRESHOLD = timedelta(days=3)
PROJECT_DEADLINE_WINDOW = timedelta(days=7)
ACTIVE_PROJECT_STAGES = tuple(
    s for s in ProjectStage if s not in (ProjectStage.MAINTENANCE, ProjectStage.COMPLETE)
)

# Relative weight of each scored factor in the final priority_score.
# Urgency dominates (an overdue/broken thing outranks a merely valuable
# one), deadline is next (time pressure), then opportunity and pipeline
# value as tie-breakers among things that are otherwise similarly
# urgent — a $10k proposal gone quiet edges out a $500 one.
WEIGHT_URGENCY = 0.45
WEIGHT_DEADLINE = 0.25
WEIGHT_OPPORTUNITY = 0.20
WEIGHT_PIPELINE_VALUE = 0.10

# Pipeline value is normalized against this cap rather than the
# workspace's actual max deal size, so one outlier deal doesn't rescale
# every other item's score — $10k is comfortably above this system's
# typical small-business website engagement (see docs/00_VISION.md).
PIPELINE_VALUE_SCORE_CAP_CENTS = 1_000_000


@dataclasses.dataclass
class _Candidate:
    kind: ActionKind
    entity_type: str
    entity_id: uuid.UUID
    title: str
    detail: str
    action_text: str
    href: str
    urgency: int
    opportunity: int
    deadline: int
    pipeline_value_cents: int = 0


def _clamp(value: float) -> int:
    return max(0, min(100, round(value)))


def _value_score(pipeline_value_cents: int) -> int:
    return _clamp(100 * pipeline_value_cents / PIPELINE_VALUE_SCORE_CAP_CENTS)


def _lead_opportunity_score(lead: Lead) -> int:
    """Prefers the lead's own computed score; falls back to a coarse
    mapping off priority when no score has been run yet — never
    fabricates a number that wasn't actually derived from something."""
    if lead.score is not None:
        return _clamp(lead.score)
    return {LeadPriority.HIGH: 75, LeadPriority.MEDIUM: 50, LeadPriority.LOW: 25}[lead.priority]


def _open_opportunity_value_cents(lead: Lead) -> int:
    open_opportunities = [o for o in lead.sales_opportunities if o.status == OpportunityStatus.OPEN]
    if not open_opportunities:
        return 0
    return max((o.proposed_price_cents or 0) for o in open_opportunities)


def _hot_leads_uncontacted(db: Session, workspace_id: uuid.UUID, now: datetime) -> list[_Candidate]:
    cutoff = now - HOT_LEAD_GRACE_PERIOD
    leads = db.scalars(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(
            Business.workspace_id == workspace_id,
            Lead.archived_at.is_(None),
            Lead.priority == LeadPriority.HIGH,
            Lead.status.in_((LeadStatus.NEW, LeadStatus.RESEARCHED, LeadStatus.QUALIFIED)),
            Lead.created_at <= cutoff,
        )
        .options(joinedload(Lead.business), joinedload(Lead.sales_opportunities))
    ).unique()

    candidates = []
    for lead in leads:
        days_waiting = max(0, (now - lead.created_at).days)
        candidates.append(
            _Candidate(
                kind=ActionKind.HOT_LEAD_UNCONTACTED,
                entity_type="lead",
                entity_id=lead.id,
                title=lead.business.name,
                detail=f"High-priority lead, no outreach sent yet — waiting {days_waiting} day(s)",
                action_text="Draft and send outreach",
                href=f"/dashboard/leads/{lead.id}",
                urgency=_clamp(55 + days_waiting * 10),
                opportunity=_lead_opportunity_score(lead),
                deadline=_clamp(50 + days_waiting * 10),
                pipeline_value_cents=_open_opportunity_value_cents(lead),
            )
        )
    return candidates


def _overdue_follow_ups(db: Session, workspace_id: uuid.UUID, today: date) -> list[_Candidate]:
    follow_ups = db.scalars(
        select(FollowUp)
        .join(Lead, FollowUp.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(
            Business.workspace_id == workspace_id,
            Lead.archived_at.is_(None),
            FollowUp.status == FollowUpStatus.PENDING,
            FollowUp.due_date < today,
        )
        .options(joinedload(FollowUp.lead).joinedload(Lead.business), joinedload(FollowUp.lead).joinedload(Lead.sales_opportunities))
    ).unique()

    candidates = []
    for follow_up in follow_ups:
        days_late = (today - follow_up.due_date).days
        candidates.append(
            _Candidate(
                kind=ActionKind.FOLLOW_UP_OVERDUE,
                entity_type="follow_up",
                entity_id=follow_up.id,
                title=follow_up.lead.business.name,
                detail=f"Follow-up {days_late} day{'s' if days_late != 1 else ''} overdue",
                action_text=follow_up.suggested_next_action,
                href=f"/dashboard/leads/{follow_up.lead_id}",
                urgency=_clamp(60 + days_late * 8),
                opportunity=_lead_opportunity_score(follow_up.lead),
                deadline=_clamp(60 + days_late * 12),
                pipeline_value_cents=_open_opportunity_value_cents(follow_up.lead),
            )
        )
    return candidates


def _meetings_approaching(db: Session, workspace_id: uuid.UUID, now: datetime) -> list[_Candidate]:
    from sqlalchemy import or_
    from sqlalchemy.orm import aliased

    project_business = aliased(Business)
    lead_business = aliased(Business)

    meetings = db.scalars(
        select(Meeting)
        .outerjoin(Project, Meeting.project_id == Project.id)
        .outerjoin(Client, Project.client_id == Client.id)
        .outerjoin(project_business, Client.business_id == project_business.id)
        .outerjoin(Lead, Meeting.lead_id == Lead.id)
        .outerjoin(lead_business, Lead.business_id == lead_business.id)
        .where(
            or_(project_business.workspace_id == workspace_id, lead_business.workspace_id == workspace_id),
            Meeting.status == MeetingStatus.SCHEDULED,
            Meeting.scheduled_at >= now,
            Meeting.scheduled_at <= now + MEETING_APPROACHING_WINDOW,
        )
        .options(
            joinedload(Meeting.project),
            joinedload(Meeting.lead).joinedload(Lead.business),
            joinedload(Meeting.lead).joinedload(Lead.sales_opportunities),
        )
    ).unique()

    candidates = []
    for meeting in meetings:
        hours_until = max(0.0, (meeting.scheduled_at - now).total_seconds() / 3600)
        subject = meeting.project.name if meeting.project else meeting.lead.business.name
        pipeline_value = _open_opportunity_value_cents(meeting.lead) if meeting.lead else (meeting.project.price_cents or 0 if meeting.project else 0)
        candidates.append(
            _Candidate(
                kind=ActionKind.MEETING_APPROACHING,
                entity_type="meeting",
                entity_id=meeting.id,
                title=subject,
                detail=f"{meeting.title} — {meeting.scheduled_at.strftime('%a %d %b, %H:%M')}",
                action_text="Review the meeting brief before you dial in",
                href="/dashboard/calendar",
                urgency=_clamp(100 - hours_until),
                opportunity=_lead_opportunity_score(meeting.lead) if meeting.lead else 60,
                deadline=_clamp(100 - hours_until),
                pipeline_value_cents=pipeline_value,
            )
        )
    return candidates


def _proposals_awaiting_response(db: Session, workspace_id: uuid.UUID, now: datetime) -> list[_Candidate]:
    stale_cutoff = now - PROPOSAL_STALE_THRESHOLD
    leads = db.scalars(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(
            Business.workspace_id == workspace_id,
            Lead.archived_at.is_(None),
            Lead.status == LeadStatus.PROPOSAL,
            Lead.updated_at <= stale_cutoff,
        )
        .options(joinedload(Lead.business), joinedload(Lead.sales_opportunities))
    ).unique()

    candidates = []
    for lead in leads:
        value_cents = _open_opportunity_value_cents(lead)
        days_quiet = max(0, (now - lead.updated_at).days)
        candidates.append(
            _Candidate(
                kind=ActionKind.PROPOSAL_AWAITING_RESPONSE,
                entity_type="lead",
                entity_id=lead.id,
                title=lead.business.name,
                detail=f"Proposal sent, no response in {days_quiet} day(s)",
                action_text="Chase the proposal, or mark it lost",
                href=f"/dashboard/leads/{lead.id}",
                urgency=_clamp(50 + days_quiet * 6),
                opportunity=_lead_opportunity_score(lead),
                deadline=_clamp(45 + days_quiet * 6),
                pipeline_value_cents=value_cents,
            )
        )
    return candidates


def _client_assets_missing(db: Session, workspace_id: uuid.UUID) -> list[_Candidate]:
    briefs = db.scalars(
        select(DesignBrief)
        .join(Project, DesignBrief.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(
            Business.workspace_id == workspace_id,
            DesignBrief.status == BriefStatus.DRAFT,
            Project.stage.in_(ACTIVE_PROJECT_STAGES),
        )
        .options(joinedload(DesignBrief.project).joinedload(Project.client).joinedload(Client.business))
    ).unique()

    candidates = []
    for brief in briefs:
        missing_assets = BriefRead.from_model(brief).assets.missing
        if not missing_assets:
            continue
        project = brief.project
        candidates.append(
            _Candidate(
                kind=ActionKind.CLIENT_ASSETS_MISSING,
                entity_type="design_brief",
                entity_id=brief.id,
                title=project.client.business.name,
                detail=f"Waiting on: {', '.join(missing_assets)}",
                action_text="Chase the client for the missing assets, or fill them in yourself",
                href=f"/dashboard/projects/{project.id}",
                urgency=40,
                opportunity=_clamp(40 + (project.price_cents or 0) / 20000),
                deadline=_deadline_score_for(project.deadline),
                pipeline_value_cents=project.price_cents or 0,
            )
        )
    return candidates


def _website_revisions_awaiting_approval(db: Session, workspace_id: uuid.UUID) -> list[_Candidate]:
    """Latest website version per active project, where the operator
    hasn't approved that version yet — same gate as
    dashboard.service._next_project_action's "Build" checkpoint, just
    surfaced as its own queue item rather than folded into a generic
    per-project "next gate" line."""
    projects = list(
        db.scalars(
            select(Project)
            .join(Client, Project.client_id == Client.id)
            .join(Business, Client.business_id == Business.id)
            .where(Business.workspace_id == workspace_id, Project.stage.in_(ACTIVE_PROJECT_STAGES))
            .options(joinedload(Project.client).joinedload(Client.business))
        )
    )
    if not projects:
        return []
    project_ids = [p.id for p in projects]
    latest_websites = db.scalars(
        select(Website).where(Website.project_id.in_(project_ids)).distinct(Website.project_id).order_by(
            Website.project_id, Website.generated_at.desc()
        )
    )
    projects_by_id = {p.id: p for p in projects}

    candidates = []
    for website in latest_websites:
        if website.approved:
            continue
        project = projects_by_id[website.project_id]
        candidates.append(
            _Candidate(
                kind=ActionKind.WEBSITE_REVISION_AWAITING_APPROVAL,
                entity_type="website",
                entity_id=website.id,
                title=project.client.business.name,
                detail=f"Generated website for {project.name} awaiting your approval",
                action_text="Review the generated site and approve it",
                href=f"/dashboard/projects/{project.id}/website",
                urgency=55,
                opportunity=_clamp(40 + (project.price_cents or 0) / 20000),
                deadline=_deadline_score_for(project.deadline),
                pipeline_value_cents=project.price_cents or 0,
            )
        )
    return candidates


def _deployments_failed(db: Session, workspace_id: uuid.UUID) -> list[_Candidate]:
    projects = list(
        db.scalars(
            select(Project)
            .join(Client, Project.client_id == Client.id)
            .join(Business, Client.business_id == Business.id)
            .where(Business.workspace_id == workspace_id, Project.stage.in_(ACTIVE_PROJECT_STAGES))
            .options(joinedload(Project.client).joinedload(Client.business))
        )
    )
    if not projects:
        return []
    project_ids = [p.id for p in projects]
    website_ids = list(
        db.scalars(select(Website.id).where(Website.project_id.in_(project_ids)))
    )
    if not website_ids:
        return []
    latest_deployments = db.scalars(
        select(Deployment).where(Deployment.website_id.in_(website_ids)).distinct(Deployment.website_id).order_by(
            Deployment.website_id, Deployment.created_at.desc()
        )
    )
    website_to_project = {
        w.id: w.project_id for w in db.scalars(select(Website).where(Website.id.in_(website_ids)))
    }
    projects_by_id = {p.id: p for p in projects}

    candidates = []
    for deployment in latest_deployments:
        if deployment.status != "failed":
            continue
        project = projects_by_id[website_to_project[deployment.website_id]]
        candidates.append(
            _Candidate(
                kind=ActionKind.DEPLOYMENT_FAILED,
                entity_type="deployment",
                entity_id=deployment.id,
                title=project.client.business.name,
                detail=f"Deployment to {deployment.environment} failed",
                action_text="Check the error and re-run the deployment",
                href=f"/dashboard/projects/{project.id}",
                urgency=100,
                opportunity=_clamp(60 + (project.price_cents or 0) / 20000),
                deadline=100,
                pipeline_value_cents=project.price_cents or 0,
            )
        )
    return candidates


def _deadline_score_for(deadline: date | None) -> int:
    if deadline is None:
        return 20
    today = datetime.now().astimezone().date()
    days_left = (deadline - today).days
    if days_left < 0:
        return 100
    if days_left > PROJECT_DEADLINE_WINDOW.days:
        return 20
    return _clamp(100 - (days_left / PROJECT_DEADLINE_WINDOW.days) * 80)


def _project_deadlines_approaching(db: Session, workspace_id: uuid.UUID) -> list[_Candidate]:
    today = datetime.now().astimezone().date()
    cutoff = today + PROJECT_DEADLINE_WINDOW
    projects = db.scalars(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(
            Business.workspace_id == workspace_id,
            Project.stage.in_(ACTIVE_PROJECT_STAGES),
            Project.deadline.is_not(None),
            Project.deadline <= cutoff,
        )
        .options(joinedload(Project.client).joinedload(Client.business))
    )

    candidates = []
    for project in projects:
        days_left = (project.deadline - today).days
        overdue = days_left < 0
        candidates.append(
            _Candidate(
                kind=ActionKind.PROJECT_DEADLINE_APPROACHING,
                entity_type="project",
                entity_id=project.id,
                title=project.client.business.name,
                detail=(
                    f"{project.name} deadline was {abs(days_left)} day(s) ago"
                    if overdue
                    else f"{project.name} due in {days_left} day(s)"
                ),
                action_text="Check the project is on track, or reset the deadline with the client",
                href=f"/dashboard/projects/{project.id}",
                urgency=_clamp(70 if overdue else 40 + (PROJECT_DEADLINE_WINDOW.days - days_left) * 4),
                opportunity=_clamp(40 + (project.price_cents or 0) / 20000),
                deadline=_deadline_score_for(project.deadline),
                pipeline_value_cents=project.price_cents or 0,
            )
        )
    return candidates


def _score(candidate: _Candidate) -> float:
    return (
        candidate.urgency * WEIGHT_URGENCY
        + candidate.deadline * WEIGHT_DEADLINE
        + candidate.opportunity * WEIGHT_OPPORTUNITY
        + _value_score(candidate.pipeline_value_cents) * WEIGHT_PIPELINE_VALUE
    )


def generate_queue(db: Session, workspace_id: uuid.UUID) -> DailyActionRun:
    """
    Builds and persists a fresh ranked queue for the workspace. Always
    creates a new `DailyActionRun` rather than mutating the latest one —
    a run is a snapshot ("what did the engine surface this morning"),
    not a live view; `get_latest_queue` below is what callers use for
    "give me today's queue, generating one if it doesn't exist yet".
    """
    now = datetime.now(timezone.utc)
    today = datetime.now().astimezone().date()

    candidates: list[_Candidate] = [
        *_hot_leads_uncontacted(db, workspace_id, now),
        *_overdue_follow_ups(db, workspace_id, today),
        *_meetings_approaching(db, workspace_id, now),
        *_proposals_awaiting_response(db, workspace_id, now),
        *_client_assets_missing(db, workspace_id),
        *_website_revisions_awaiting_approval(db, workspace_id),
        *_deployments_failed(db, workspace_id),
        *_project_deadlines_approaching(db, workspace_id),
    ]

    scored = sorted(
        ((_score(c), c) for c in candidates),
        key=lambda pair: (-pair[0], -pair[1].pipeline_value_cents),
    )

    run = DailyActionRun(workspace_id=workspace_id, item_count=len(scored))
    db.add(run)
    db.flush()

    for rank, (priority, candidate) in enumerate(scored, start=1):
        db.add(
            ActionQueueItem(
                run_id=run.id,
                workspace_id=workspace_id,
                kind=candidate.kind,
                entity_type=candidate.entity_type,
                entity_id=candidate.entity_id,
                title=candidate.title,
                detail=candidate.detail,
                action_text=candidate.action_text,
                href=candidate.href,
                urgency_score=candidate.urgency,
                opportunity_score=candidate.opportunity,
                deadline_score=candidate.deadline,
                pipeline_value_cents=candidate.pipeline_value_cents,
                priority_score=round(priority, 2),
                rank=rank,
            )
        )

    db.commit()
    db.refresh(run)
    return run


def get_latest_run(db: Session, workspace_id: uuid.UUID) -> DailyActionRun | None:
    return db.scalar(
        select(DailyActionRun)
        .where(DailyActionRun.workspace_id == workspace_id)
        .options(joinedload(DailyActionRun.items))
        .order_by(DailyActionRun.generated_at.desc())
        .limit(1)
    )


def get_or_generate_todays_queue(db: Session, workspace_id: uuid.UUID) -> DailyActionRun:
    """Every morning the engine should calculate a fresh queue — but an
    operator opening the app mid-morning shouldn't see a stale run from
    yesterday, nor trigger a brand new (re-ranking, re-scoring)
    recompute on every page load. One run per calendar day (workspace-
    local) is the balance: lazily generated on first access, then
    reused for the rest of that day."""
    latest = get_latest_run(db, workspace_id)
    today = datetime.now().astimezone().date()
    if latest is not None and latest.generated_at.astimezone().date() == today:
        return latest
    return generate_queue(db, workspace_id)


def list_history(db: Session, workspace_id: uuid.UUID, limit: int = 14) -> list[DailyActionRun]:
    return list(
        db.scalars(
            select(DailyActionRun)
            .where(DailyActionRun.workspace_id == workspace_id)
            .options(joinedload(DailyActionRun.items))
            .order_by(DailyActionRun.generated_at.desc())
            .limit(limit)
        ).unique()
    )
