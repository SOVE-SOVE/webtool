"""
Aggregate metrics and the "what should I do next" list for the Overview
page, scoped to the current user's workspace (see
docs/02_ARCHITECTURE.md §3 — every query here joins up to
`businesses.workspace_id` since child tables don't carry their own
workspace_id). Every number here comes from a real query — nothing
hardcoded. Definitions, since several of these are judgment calls the
schema doesn't spell out on its own:

- qualified_leads: leads whose status is QUALIFIED, CONTACTED, REPLIED,
  MEETING, PROPOSAL, or WON — i.e. past initial triage, into active
  pursuit. Updated 2026-08-16 for the LeadStatus redesign — see
  docs/05_DECISIONS.md; NEW/RESEARCHED/LOST/NURTURE don't count.
- contacted_leads: leads with at least one logged OUTREACH_SENT
  interaction (the actual event, not just current status).

Every lead-based metric below only counts non-archived leads
(archived_at IS NULL) — archiving a lead is the operator saying "stop
tracking this as part of the active pipeline," so it shouldn't inflate
totals or show up needing attention. This is threaded through the
`lead_in_workspace` subquery plus the two direct-count queries below.
- upcoming_meetings: meetings still scheduled (not held/cancelled/
  no-show) with a start time in the future. Was a count of *every*
  meeting ever booked until 2026-08-21 — a number that only ever went
  up and that no operator could act on. See docs/05_DECISIONS.md.
- won_projects: sales_opportunities with status=WON — the count of
  deals actually closed, not project delivery status.
- active_projects: projects not yet at MAINTENANCE or COMPLETE — the two
  post-launch stages (ongoing care, and fully closed out). Updated
  2026-08-19 when COMPLETE was added after MAINTENANCE in the project
  stage redesign — see docs/05_DECISIONS.md.
- revenue_cents: sum of proposed_price_cents on WON opportunities.
  There's no invoicing/payments table yet (see docs/06_SECURITY.md /
  02_ARCHITECTURE.md "to be decided") — this is booked/won value, not
  cash collected. Revisit the label if payments land in a later
  milestone.
- follow_ups_due: pending follow-ups due today or already overdue.
- needs_attention: see `_ATTENTION_*` below — every open loop across
  both sides of the business, each carrying the concrete next action
  and a link to the screen where it's done.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased, joinedload

from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.dashboard.schemas import AttentionItem, DashboardOverview, WebsitePipeline
from app.modules.deployments.models import Deployment
from app.modules.design_briefs.models import BriefStatus, DesignBrief
from app.modules.interactions.models import Interaction, InteractionKind
from app.modules.leads.models import Lead, LeadStatus
from app.modules.meetings.models import Meeting, MeetingStatus
from app.modules.outreach.models import FollowUp, FollowUpStatus
from app.modules.projects.models import Project, ProjectStage
from app.modules.qa_reports.models import QaReport
from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity
from app.modules.sitemaps.models import Sitemap, SitemapStatus
from app.modules.tasks.models import Task
from app.modules.websites.models import Website

QUALIFIED_STATUSES = (
    LeadStatus.QUALIFIED,
    LeadStatus.CONTACTED,
    LeadStatus.REPLIED,
    LeadStatus.MEETING,
    LeadStatus.PROPOSAL,
    LeadStatus.WON,
)
FINISHED_PROJECT_STAGES = (ProjectStage.MAINTENANCE, ProjectStage.COMPLETE)

# Website-pipeline buckets for the Overview (see WebsitePipeline). A
# project is "building" from intake through development, "in review"
# while it's in QA / client review / revisions; the remaining stages map
# one-to-one. COMPLETE (fully closed out) isn't surfaced as a live site.
_BUILDING_STAGES = (
    ProjectStage.INTAKE,
    ProjectStage.RESEARCH,
    ProjectStage.BRIEF,
    ProjectStage.DESIGN,
    ProjectStage.DEVELOPMENT,
)
_REVIEW_STAGES = (ProjectStage.QA, ProjectStage.CLIENT_REVIEW, ProjectStage.REVISIONS)
STALE_LEAD_THRESHOLD = timedelta(days=5)
ATTENTION_DUE_WINDOW = timedelta(days=2)
UPCOMING_MEETING_WINDOW = timedelta(days=2)
ATTENTION_LIMIT = 30

# Sort order for the attention list — lower comes first. The ranking is
# "who is waiting on me, and how badly": something broken or blocking a
# client outranks something merely scheduled, which outranks routine
# hygiene. Kept as one table so the ordering is readable in one place
# rather than scattered across the builders below.
_BROKEN_DEPLOYMENT = 0
_OVERDUE_FOLLOW_UP = 1
_IMMINENT_MEETING = 2
_PROJECT_BLOCKED = 3
_OVERDUE_TASK = 4
_FOLLOW_UP_DUE_TODAY = 5
_UPCOMING_TASK = 6
_STALE_LEAD = 7

_ProjectBusiness = aliased(Business)
_LeadBusiness = aliased(Business)


def get_overview(db: Session, workspace_id: uuid.UUID) -> DashboardOverview:
    now = datetime.now(timezone.utc)
    # `FollowUp.due_date` is a plain date the operator picks in their own
    # (local) timezone, not UTC — using now.date() here would shift the
    # overdue count by a day for roughly half the day in any timezone
    # ahead of or behind UTC. Everything else on this page compares
    # against `now` (tz-aware timestamptz columns), where UTC is fine.
    today = datetime.now().astimezone().date()

    lead_in_workspace = (
        select(Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Lead.archived_at.is_(None))
    )

    total_leads = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .join(Business, Lead.business_id == Business.id)
            .where(Business.workspace_id == workspace_id, Lead.archived_at.is_(None))
        )
        or 0
    )

    qualified_leads = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .join(Business, Lead.business_id == Business.id)
            .where(
                Business.workspace_id == workspace_id,
                Lead.archived_at.is_(None),
                Lead.status.in_(QUALIFIED_STATUSES),
            )
        )
        or 0
    )

    contacted_leads = (
        db.scalar(
            select(func.count(func.distinct(Interaction.lead_id))).where(
                Interaction.kind == InteractionKind.OUTREACH_SENT,
                Interaction.lead_id.in_(lead_in_workspace),
            )
        )
        or 0
    )

    # Meetings belong to a project or a lead (see docs/05_DECISIONS.md),
    # so both paths are outer-joined and matched with OR — same pattern
    # as the task_base query below.
    meeting_base = (
        select(Meeting)
        .outerjoin(Project, Meeting.project_id == Project.id)
        .outerjoin(Client, Project.client_id == Client.id)
        .outerjoin(_ProjectBusiness, Client.business_id == _ProjectBusiness.id)
        .outerjoin(Lead, Meeting.lead_id == Lead.id)
        .outerjoin(_LeadBusiness, Lead.business_id == _LeadBusiness.id)
        .where(
            or_(
                _ProjectBusiness.workspace_id == workspace_id,
                _LeadBusiness.workspace_id == workspace_id,
            )
        )
    )
    upcoming_meeting_rows = list(
        db.scalars(
            meeting_base.options(
                joinedload(Meeting.project), joinedload(Meeting.lead).joinedload(Lead.business)
            )
            .where(Meeting.status == MeetingStatus.SCHEDULED, Meeting.scheduled_at >= now)
            .order_by(Meeting.scheduled_at.asc())
        )
    )
    upcoming_meetings = len(upcoming_meeting_rows)

    won_projects = (
        db.scalar(
            select(func.count())
            .select_from(SalesOpportunity)
            .where(
                SalesOpportunity.status == OpportunityStatus.WON,
                SalesOpportunity.lead_id.in_(lead_in_workspace),
            )
        )
        or 0
    )

    active_project_rows = list(
        db.scalars(
            select(Project)
            .join(Client, Project.client_id == Client.id)
            .join(Business, Client.business_id == Business.id)
            .where(
                Business.workspace_id == workspace_id,
                Project.stage.not_in(FINISHED_PROJECT_STAGES),
            )
            .options(joinedload(Project.client).joinedload(Client.business))
            .order_by(Project.created_at.asc())
        )
    )
    active_projects = len(active_project_rows)

    # Website delivery pipeline — every project bucketed by its stage, so
    # the Overview can answer "how many sites are being built / in review
    # / live / in maintenance" at a glance. Derived from Project.stage
    # (the operator-set delivery stage every project has), not recomputed
    # from website/QA/deployment rows.
    stage_counts_rows = db.execute(
        select(Project.stage, func.count())
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .group_by(Project.stage)
    ).all()
    stage_counts = {stage: count for stage, count in stage_counts_rows}
    websites = WebsitePipeline(
        building=sum(stage_counts.get(s, 0) for s in _BUILDING_STAGES),
        in_review=sum(stage_counts.get(s, 0) for s in _REVIEW_STAGES),
        ready_to_launch=stage_counts.get(ProjectStage.READY_TO_DEPLOY, 0),
        deployed=stage_counts.get(ProjectStage.DEPLOYED, 0),
        maintenance=stage_counts.get(ProjectStage.MAINTENANCE, 0),
    )

    revenue_cents = (
        db.scalar(
            select(func.coalesce(func.sum(SalesOpportunity.proposed_price_cents), 0)).where(
                SalesOpportunity.status == OpportunityStatus.WON,
                SalesOpportunity.lead_id.in_(lead_in_workspace),
            )
        )
        or 0
    )

    task_base = (
        select(Task)
        .outerjoin(Project, Task.project_id == Project.id)
        .outerjoin(Client, Project.client_id == Client.id)
        .outerjoin(_ProjectBusiness, Client.business_id == _ProjectBusiness.id)
        .outerjoin(Lead, Task.lead_id == Lead.id)
        .outerjoin(_LeadBusiness, Lead.business_id == _LeadBusiness.id)
        .where(
            or_(
                _ProjectBusiness.workspace_id == workspace_id,
                _LeadBusiness.workspace_id == workspace_id,
            )
        )
    )

    attention_due_before = now + ATTENTION_DUE_WINDOW
    due_tasks = db.scalars(
        task_base.options(joinedload(Task.project), joinedload(Task.lead).joinedload(Lead.business))
        .where(Task.done.is_(False))
        .where(or_(Task.due_at.is_(None), Task.due_at <= attention_due_before))
        .order_by(Task.due_at.asc().nulls_last())
        .limit(ATTENTION_LIMIT)
    )
    scored: list[tuple[int, AttentionItem]] = []
    for task in due_tasks:
        overdue = task.due_at is not None and task.due_at <= now
        scored.append(
            (
                _OVERDUE_TASK if overdue else _UPCOMING_TASK,
                AttentionItem(
                    kind="task",
                    label="Task",
                    id=task.id,
                    title=task.title,
                    detail=_task_detail(task, now),
                    action="Do it, or tick it off",
                    href="/dashboard/tasks",
                ),
            )
        )

    attention_task_subquery = (
        task_base.where(Task.done.is_(False))
        .where(or_(Task.due_at.is_(None), Task.due_at <= attention_due_before))
        .subquery()
    )
    tasks_needing_attention = (
        db.scalar(select(func.count()).select_from(attention_task_subquery)) or 0
    )

    follow_ups = list(
        db.scalars(
            select(FollowUp)
            .join(Lead, FollowUp.lead_id == Lead.id)
            .join(Business, Lead.business_id == Business.id)
            .where(
                Business.workspace_id == workspace_id,
                Lead.archived_at.is_(None),
                FollowUp.status == FollowUpStatus.PENDING,
                FollowUp.due_date <= today,
            )
            .options(joinedload(FollowUp.lead).joinedload(Lead.business))
            .order_by(FollowUp.due_date.asc())
        ).unique()
    )
    follow_ups_due = len(follow_ups)
    for follow_up in follow_ups:
        overdue = follow_up.due_date < today
        days_late = (today - follow_up.due_date).days
        scored.append(
            (
                _OVERDUE_FOLLOW_UP if overdue else _FOLLOW_UP_DUE_TODAY,
                AttentionItem(
                    kind="follow_up",
                    label="Follow-up",
                    id=follow_up.id,
                    title=follow_up.lead.business.name,
                    detail=f"{days_late} day{'s' if days_late != 1 else ''} overdue" if overdue else "Due today",
                    action=follow_up.suggested_next_action,
                    href=f"/dashboard/leads/{follow_up.lead_id}",
                ),
            )
        )

    meeting_cutoff = now + UPCOMING_MEETING_WINDOW
    for meeting in upcoming_meeting_rows:
        if meeting.scheduled_at > meeting_cutoff:
            break  # ordered by scheduled_at, so nothing after this is imminent either
        subject = meeting.project.name if meeting.project else meeting.lead.business.name
        scored.append(
            (
                _IMMINENT_MEETING,
                AttentionItem(
                    kind="meeting",
                    label="Meeting",
                    id=meeting.id,
                    title=subject,
                    detail=f"{meeting.title} — {meeting.scheduled_at.strftime('%a %d %b, %H:%M')}",
                    action="Review the meeting brief before you dial in",
                    href="/dashboard/calendar",
                ),
            )
        )

    scored.extend(_project_attention_items(db, active_project_rows))

    stale_cutoff = now - STALE_LEAD_THRESHOLD
    stale_leads = db.execute(
        select(Lead, Business)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .where(Lead.archived_at.is_(None))
        .where(Lead.status.not_in((LeadStatus.WON, LeadStatus.LOST)))
        .where(Lead.updated_at <= stale_cutoff)
        .order_by(Lead.updated_at.asc())
        .limit(ATTENTION_LIMIT)
    )
    for lead, business in stale_leads:
        scored.append(
            (
                _STALE_LEAD,
                AttentionItem(
                    kind="stale_lead",
                    label="Stale lead",
                    id=lead.id,
                    title=business.name,
                    detail=f"No movement in {(now - lead.updated_at).days} days — still at {lead.status.value}",
                    action=_stale_lead_action(lead.status),
                    href=f"/dashboard/leads/{lead.id}",
                ),
            )
        )

    scored.sort(key=lambda pair: pair[0])

    return DashboardOverview(
        total_leads=total_leads,
        qualified_leads=qualified_leads,
        contacted_leads=contacted_leads,
        upcoming_meetings=upcoming_meetings,
        won_projects=won_projects,
        active_projects=active_projects,
        websites=websites,
        revenue_cents=revenue_cents,
        tasks_needing_attention=tasks_needing_attention,
        follow_ups_due=follow_ups_due,
        needs_attention=[item for _, item in scored[:ATTENTION_LIMIT]],
    )


def _stale_lead_action(status: LeadStatus) -> str:
    """The next move depends on how far the lead already got — a NEW lead
    needs research, a CONTACTED one needs chasing."""
    if status in (LeadStatus.NEW, LeadStatus.RESEARCHED):
        return "Research it and qualify, or archive it"
    if status == LeadStatus.QUALIFIED:
        return "Draft and send outreach"
    if status in (LeadStatus.CONTACTED, LeadStatus.REPLIED):
        return "Schedule a follow-up, or book a meeting"
    if status == LeadStatus.MEETING:
        return "Record the meeting outcome and send a proposal"
    if status == LeadStatus.PROPOSAL:
        return "Chase the proposal, or mark it lost"
    return "Decide whether this is still worth pursuing"


def _latest_per(db: Session, model, group_column, order_column, keys: list[uuid.UUID]) -> dict:
    """
    One row per group — the newest. Postgres DISTINCT ON, so this stays a
    single query for the whole dashboard instead of N per-project lookups
    like modules/approvals/service.py's single-project resolvers do.
    """
    if not keys:
        return {}
    rows = db.scalars(
        select(model)
        .where(group_column.in_(keys))
        .distinct(group_column)
        .order_by(group_column, order_column.desc())
    ).unique()
    return {getattr(row, group_column.key): row for row in rows}


def _project_attention_items(db: Session, projects: list[Project]) -> list[tuple[int, AttentionItem]]:
    """
    The single most useful next action for each unfinished project — one
    row per project, never a pile of them, so the list stays a to-do list
    rather than a status dump.

    The gate order below mirrors modules/approvals/service.py's
    checkpoint order (brief -> creative direction -> sitemap -> website
    -> QA -> client review -> deploy), which stays the authority for a
    single project's full checkpoint detail; this is the batched
    "first unmet gate" view of the same sequence for every project at
    once. Keep the two in step if a checkpoint is ever added or reordered.
    """
    if not projects:
        return []

    project_ids = [p.id for p in projects]
    briefs = _latest_per(db, DesignBrief, DesignBrief.project_id, DesignBrief.created_at, project_ids)
    directions = _latest_per(
        db, CreativeDirectionBrief, CreativeDirectionBrief.project_id, CreativeDirectionBrief.generated_at, project_ids
    )
    sitemaps = _latest_per(db, Sitemap, Sitemap.project_id, Sitemap.generated_at, project_ids)
    websites = _latest_per(db, Website, Website.project_id, Website.generated_at, project_ids)

    website_ids = [w.id for w in websites.values()]
    qa_reports = _latest_per(db, QaReport, QaReport.website_id, QaReport.created_at, website_ids)
    deployments = _latest_per(db, Deployment, Deployment.website_id, Deployment.created_at, website_ids)

    items: list[tuple[int, AttentionItem]] = []
    for project in projects:
        resolved = _next_project_action(
            brief=briefs.get(project.id),
            direction=directions.get(project.id),
            sitemap=sitemaps.get(project.id),
            website=websites.get(project.id),
            qa_reports=qa_reports,
            deployments=deployments,
        )
        if resolved is None:
            continue
        priority, label, detail, action, path = resolved
        items.append(
            (
                priority,
                AttentionItem(
                    kind="project",
                    label=label,
                    id=project.id,
                    title=project.name,
                    detail=f"{project.client.business.name} — {detail}",
                    action=action,
                    href=f"/dashboard/projects/{project.id}{path}",
                ),
            )
        )
    return items


def _next_project_action(
    *,
    brief: DesignBrief | None,
    direction: CreativeDirectionBrief | None,
    sitemap: Sitemap | None,
    website: Website | None,
    qa_reports: dict,
    deployments: dict,
) -> tuple[int, str, str, str, str] | None:
    """Returns (priority, badge label, detail, next action, href suffix)."""
    deployment = deployments.get(website.id) if website else None

    # A failed deploy outranks every other gate: the work is done and
    # something in the publish step broke.
    if deployment is not None and deployment.status == "failed":
        return (
            _BROKEN_DEPLOYMENT,
            "Deploy",
            f"deployment to {deployment.environment} failed",
            "Check the error and re-run the deployment",
            "",
        )

    if brief is None or brief.status != BriefStatus.APPROVED:
        return (
            _PROJECT_BLOCKED,
            "Brief",
            "client brief not approved",
            "Fill in the intake brief and approve it",
            "",
        )

    if direction is None:
        return (_PROJECT_BLOCKED, "Creative", "no creative direction yet", "Generate the creative direction", "")
    if direction.status != CreativeDirectionStatus.APPROVED:
        return (
            _PROJECT_BLOCKED,
            "Creative",
            "creative direction awaiting approval",
            "Review and approve the creative direction",
            "",
        )

    if sitemap is None:
        return (_PROJECT_BLOCKED, "Sitemap", "no sitemap yet", "Generate the sitemap", "")
    if sitemap.status != SitemapStatus.APPROVED:
        return (_PROJECT_BLOCKED, "Sitemap", "sitemap awaiting approval", "Review and approve the sitemap", "")

    if website is None:
        return (_PROJECT_BLOCKED, "Build", "no website generated yet", "Generate the website", "/website")
    if not website.approved:
        return (
            _PROJECT_BLOCKED,
            "Build",
            "generated website awaiting your approval",
            "Review the generated site and approve it",
            "/website",
        )

    qa = qa_reports.get(website.id)
    if qa is None:
        return (_PROJECT_BLOCKED, "QA", "no QA run on this version", "Run technical QA", "/website")
    if not qa.passed:
        return (
            _PROJECT_BLOCKED,
            "QA",
            "QA found critical issues",
            "Fix the critical issues and re-run QA",
            "/website",
        )
    if not qa.human_approved:
        return (_PROJECT_BLOCKED, "QA", "QA report awaiting sign-off", "Review the QA report and sign it off", "/website")

    if not website.client_approved:
        return (
            _PROJECT_BLOCKED,
            "Client",
            "waiting on client sign-off",
            "Send the preview to the client and record their approval",
            "",
        )

    if deployment is None:
        return (_PROJECT_BLOCKED, "Deploy", "every approval is in — ready to launch", "Deploy the site", "")

    return None


def _task_detail(task: Task, now: datetime) -> str:
    context = f"Project: {task.project.name}" if task.project else f"Lead: {task.lead.business.name}"
    if task.due_at is None:
        return f"{context} — no due date"
    if task.due_at <= now:
        return f"{context} — overdue"
    return f"{context} — due {task.due_at.date().isoformat()}"
