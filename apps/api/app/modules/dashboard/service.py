"""
Aggregate metrics for the Overview page, scoped to the current user's
workspace (see docs/02_ARCHITECTURE.md §3 — every query here joins up
to `businesses.workspace_id` since child tables don't carry their own
workspace_id). Every number here comes from a real query — nothing
hardcoded. Definitions, since several of these are judgment calls the
schema doesn't spell out on its own:

- qualified_leads: leads whose stage is LEAD_SCORE or later — i.e. past
  the audit/scoring gate, into active pursuit.
- contacted_leads: leads with at least one logged OUTREACH_SENT
  interaction (the actual event, not just current stage).
- won_projects: sales_opportunities with status=WON — the count of
  deals actually closed, not project delivery status.
- active_projects: projects not yet at the MAINTENANCE stage.
- revenue_cents: sum of proposed_price_cents on WON opportunities.
  There's no invoicing/payments table yet (see docs/06_SECURITY.md /
  02_ARCHITECTURE.md "to be decided") — this is booked/won value, not
  cash collected. Revisit the label if payments land in a later
  milestone.
- needs_attention: incomplete tasks that are overdue or due within 2
  days (or have no due date at all, since an undated task still needs
  triaging), plus leads that haven't moved in 5+ days and aren't
  already won/lost.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased, joinedload

from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.dashboard.schemas import AttentionItem, DashboardOverview
from app.modules.interactions.models import Interaction, InteractionKind
from app.modules.leads.models import Lead, LeadStage
from app.modules.meetings.models import Meeting
from app.modules.projects.models import Project, ProjectStage
from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity
from app.modules.tasks.models import Task

QUALIFIED_STAGES = (
    LeadStage.LEAD_SCORE,
    LeadStage.SALES_PREPARATION,
    LeadStage.OUTREACH,
    LeadStage.FOLLOW_UP,
    LeadStage.MEETING,
    LeadStage.WON,
)
STALE_LEAD_THRESHOLD = timedelta(days=5)
ATTENTION_DUE_WINDOW = timedelta(days=2)

_TaskProjectBusiness = aliased(Business)
_TaskLeadBusiness = aliased(Business)


def get_overview(db: Session, workspace_id: uuid.UUID) -> DashboardOverview:
    now = datetime.now(timezone.utc)

    lead_in_workspace = select(Lead.id).join(Business, Lead.business_id == Business.id).where(
        Business.workspace_id == workspace_id
    )

    total_leads = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .join(Business, Lead.business_id == Business.id)
            .where(Business.workspace_id == workspace_id)
        )
        or 0
    )

    qualified_leads = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .join(Business, Lead.business_id == Business.id)
            .where(Business.workspace_id == workspace_id, Lead.stage.in_(QUALIFIED_STAGES))
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

    meetings = (
        db.scalar(
            select(func.count())
            .select_from(Meeting)
            .join(SalesOpportunity, Meeting.sales_opportunity_id == SalesOpportunity.id)
            .where(SalesOpportunity.lead_id.in_(lead_in_workspace))
        )
        or 0
    )

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

    active_projects = (
        db.scalar(
            select(func.count())
            .select_from(Project)
            .join(Client, Project.client_id == Client.id)
            .join(Business, Client.business_id == Business.id)
            .where(Business.workspace_id == workspace_id, Project.stage != ProjectStage.MAINTENANCE)
        )
        or 0
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
        .outerjoin(_TaskProjectBusiness, Client.business_id == _TaskProjectBusiness.id)
        .outerjoin(Lead, Task.lead_id == Lead.id)
        .outerjoin(_TaskLeadBusiness, Lead.business_id == _TaskLeadBusiness.id)
        .where(
            or_(
                _TaskProjectBusiness.workspace_id == workspace_id,
                _TaskLeadBusiness.workspace_id == workspace_id,
            )
        )
    )

    attention_due_before = now + ATTENTION_DUE_WINDOW
    due_tasks = db.scalars(
        task_base.options(joinedload(Task.project), joinedload(Task.lead).joinedload(Lead.business))
        .where(Task.done.is_(False))
        .where(or_(Task.due_at.is_(None), Task.due_at <= attention_due_before))
        .order_by(Task.due_at.asc().nulls_last())
        .limit(10)
    )
    task_items = [
        AttentionItem(
            kind="task",
            id=task.id,
            title=task.title,
            detail=_task_detail(task, now),
            href="/dashboard/tasks",
        )
        for task in due_tasks
    ]

    attention_task_subquery = (
        task_base.where(Task.done.is_(False))
        .where(or_(Task.due_at.is_(None), Task.due_at <= attention_due_before))
        .subquery()
    )
    tasks_needing_attention = (
        db.scalar(select(func.count()).select_from(attention_task_subquery)) or 0
    )

    stale_cutoff = now - STALE_LEAD_THRESHOLD
    stale_leads = db.execute(
        select(Lead, Business)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .where(Lead.stage.not_in((LeadStage.WON, LeadStage.LOST)))
        .where(Lead.updated_at <= stale_cutoff)
        .order_by(Lead.updated_at.asc())
        .limit(10)
    )
    lead_items = [
        AttentionItem(
            kind="stale_lead",
            id=lead.id,
            title=business.name,
            detail=f"No movement in {(now - lead.updated_at).days} days — still at {lead.stage.value}",
            href="/dashboard/leads",
        )
        for lead, business in stale_leads
    ]

    return DashboardOverview(
        total_leads=total_leads,
        qualified_leads=qualified_leads,
        contacted_leads=contacted_leads,
        meetings=meetings,
        won_projects=won_projects,
        active_projects=active_projects,
        revenue_cents=revenue_cents,
        tasks_needing_attention=tasks_needing_attention,
        needs_attention=[*task_items, *lead_items],
    )


def _task_detail(task: Task, now: datetime) -> str:
    context = f"Project: {task.project.name}" if task.project else f"Lead: {task.lead.business.name}"
    if task.due_at is None:
        return f"{context} — no due date"
    if task.due_at <= now:
        return f"{context} — overdue"
    return f"{context} — due {task.due_at.date().isoformat()}"
