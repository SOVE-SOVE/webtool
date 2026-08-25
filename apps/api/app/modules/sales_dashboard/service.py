"""
The Sales Command Centre — roadmap Phase 3 checkpoint: everything an
operator needs to run "find -> qualify -> contact -> follow up -> book ->
close" from one screen, opened first thing every morning. Distinct from
modules/dashboard/ (the Overview), which spans the whole business
including delivery/project work; this is scoped to the sales funnel only
— every query here is a `Lead`, never a `Project`.

Definitions, since several of these are judgment calls the schema
doesn't spell out on its own:

- new_leads: status == NEW, not archived — hasn't been triaged yet.
- hot_leads: not archived, not WON/LOST/NURTURE, and either priority is
  HIGH or the lead-fit score (agents/lead_score.py — higher means more
  fixable problems found, i.e. a better-fit prospect) is >= 70. Two
  independent signals (operator judgment via priority, and the
  deterministic score) either of which is enough to call a lead hot.
- needs_follow_up: leads with a PENDING FollowUp due today or already
  overdue — same source modules/outreach/service.py's follow-ups page
  and modules/dashboard/service.py's follow_ups_due already use.
- upcoming_meetings: lead-side meetings only (Meeting.lead_id is not
  null — a sales call, never a post-sale client check-in), SCHEDULED,
  in the future. Deliberately excludes project-side meetings, which
  belong to the Overview/delivery side, not this funnel.
- proposals: leads currently at PROPOSAL status. `proposed_price_cents`
  on each is only ever real money logged via
  POST /leads/{id}/opportunities (modules/sales_opportunities/) — null
  when the lead reached PROPOSAL by a direct status edit with no quote
  logged, never guessed.
- won_deals / lost_deals: counted off `Lead.status` (WON/LOST), the
  single authoritative field for "where is this lead in the pipeline" —
  not off SalesOpportunity, which can be silent (a lead marked LOST by
  hand, with no opportunity ever logged). The recent_won/recent_lost
  *lists* enrich each with whatever SalesOpportunity row exists for
  price/tier context, which is real for every WON row (clients/service.py
  always creates one on conversion) but may be missing for a LOST one.
- conversion_rate_pct: won / (won + lost) — of leads with a *decided*
  outcome only. Dividing by every lead ever created would understate a
  healthy pipeline that's simply mid-flight; this answers "of the deals
  I've actually closed one way or the other, how many did I win."
- estimated_revenue_cents: sum of proposed_price_cents on OPEN
  SalesOpportunity rows — real logged quotes still in play, not a
  statistical guess against the open pipeline's size. A lead sitting at
  PROPOSAL with no quote logged contributes nothing; that's the honest
  answer, not a hidden zero standing in for "unknown".
- actual_revenue_cents: sum of proposed_price_cents on WON
  SalesOpportunity rows — booked/won value, same figure and caveat
  (no invoicing/payments table yet) as modules/dashboard/service.py's
  revenue_cents.
- outreach_activity: OUTREACH_SENT / REPLY interactions in the last 7
  days, workspace-scoped.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.modules.businesses.models import Business
from app.modules.dashboard.schemas import AttentionItem
from app.modules.interactions.models import Interaction, InteractionKind
from app.modules.leads.models import Lead, LeadPriority, LeadStatus
from app.modules.meetings.models import Meeting, MeetingStatus
from app.modules.outreach.models import FollowUp, FollowUpStatus
from app.modules.sales_dashboard.schemas import (
    DealSummary,
    FollowUpDue,
    LeadSummary,
    MeetingSummary,
    OutreachActivity,
    OutreachActivityItem,
    ProposalSummary,
    SalesDashboard,
)
from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity

HOT_LEAD_SCORE_THRESHOLD = 70
IMMINENT_MEETING_WINDOW = timedelta(hours=48)
NEW_LEAD_STALE_AFTER = timedelta(days=2)
PROPOSAL_STALE_AFTER = timedelta(days=5)
RECENT_LIST_LIMIT = 10
OUTREACH_RECENT_LIMIT = 15
OUTREACH_WINDOW = timedelta(days=7)
DO_THIS_NEXT_LIMIT = 30

_NON_FUNNEL_STATUSES = (LeadStatus.WON, LeadStatus.LOST, LeadStatus.NURTURE)
_PRIORITY_RANK = {LeadPriority.HIGH: 0, LeadPriority.MEDIUM: 1, LeadPriority.LOW: 2}

# "Do this next" priority tiers — lower sorts first, same "who's waiting
# on me, how badly" convention as modules/dashboard/service.py, scoped
# to the sales funnel and ordered by urgency first, opportunity second
# within a tier (see the (tier, opportunity_bonus) tuples _build_do_this_next
# appends to `scored` below).
_OVERDUE_FOLLOW_UP = 0
_IMMINENT_MEETING = 1
_HOT_LEAD_UNCONTACTED = 2
_FOLLOW_UP_DUE_TODAY = 3
_STALE_PROPOSAL = 4
_STALE_NEW_LEAD = 5


def _lead_summary(lead: Lead) -> LeadSummary:
    return LeadSummary(
        id=lead.id,
        business_name=lead.business.name,
        status=lead.status,
        priority=lead.priority,
        score=lead.score,
        updated_at=lead.updated_at,
        assigned_user_name=lead.assigned_user.name if lead.assigned_user else None,
    )


def _sort_by_opportunity(leads: list[Lead]) -> list[Lead]:
    """Highest fit-score first, then highest operator-set priority, then
    most recently touched — "opportunity" ordering shared by the hot-leads
    list and the do-this-next queue's within-tier tiebreak."""
    return sorted(
        leads,
        key=lambda lead: (
            -(lead.score if lead.score is not None else -1),
            _PRIORITY_RANK[lead.priority],
            -lead.updated_at.timestamp(),
        ),
    )


def _active_leads(db: Session, workspace_id: uuid.UUID) -> list[Lead]:
    """Every non-archived lead not yet WON/LOST — the working funnel.
    Loaded once and reused across several sections below rather than
    re-querying, since this dashboard is read on every page load."""
    return list(
        db.scalars(
            select(Lead)
            .join(Business, Lead.business_id == Business.id)
            .where(
                Business.workspace_id == workspace_id,
                Lead.archived_at.is_(None),
                Lead.status.not_in(_NON_FUNNEL_STATUSES),
            )
            .options(joinedload(Lead.business), joinedload(Lead.assigned_user), joinedload(Lead.interactions))
        ).unique()
    )


def _is_hot(lead: Lead) -> bool:
    return lead.priority == LeadPriority.HIGH or (lead.score is not None and lead.score >= HOT_LEAD_SCORE_THRESHOLD)


def get_sales_dashboard(db: Session, workspace_id: uuid.UUID) -> SalesDashboard:
    now = datetime.now(timezone.utc)
    today = now.date()

    active_leads = _active_leads(db, workspace_id)

    new_leads = sorted((lead for lead in active_leads if lead.status == LeadStatus.NEW), key=lambda lead: lead.created_at)
    hot_leads = _sort_by_opportunity([lead for lead in active_leads if _is_hot(lead)])

    # Follow-ups due today or overdue, one row per lead (a lead can only
    # usefully be followed up on once at a time) — earliest due date wins
    # if somehow more than one is pending for the same lead.
    follow_up_rows = list(
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
    seen_lead_ids: set[uuid.UUID] = set()
    needs_follow_up: list[FollowUpDue] = []
    for follow_up in follow_up_rows:
        if follow_up.lead_id in seen_lead_ids:
            continue
        seen_lead_ids.add(follow_up.lead_id)
        needs_follow_up.append(
            FollowUpDue(
                lead_id=follow_up.lead_id,
                business_name=follow_up.lead.business.name,
                due_date=follow_up.due_date,
                overdue=follow_up.due_date < today,
                suggested_next_action=follow_up.suggested_next_action,
            )
        )

    upcoming_meeting_rows = list(
        db.scalars(
            select(Meeting)
            .join(Lead, Meeting.lead_id == Lead.id)
            .join(Business, Lead.business_id == Business.id)
            .where(
                Business.workspace_id == workspace_id,
                Meeting.status == MeetingStatus.SCHEDULED,
                Meeting.scheduled_at >= now,
            )
            .options(joinedload(Meeting.lead).joinedload(Lead.business))
            .order_by(Meeting.scheduled_at.asc())
        )
    )
    upcoming_meetings = [
        MeetingSummary(
            id=m.id, lead_id=m.lead_id, business_name=m.lead.business.name, title=m.title, scheduled_at=m.scheduled_at
        )
        for m in upcoming_meeting_rows
    ]

    proposal_leads = [lead for lead in active_leads if lead.status == LeadStatus.PROPOSAL]
    open_opportunities = _latest_by_lead(db, [lead.id for lead in proposal_leads], OpportunityStatus.OPEN)
    proposals = [
        ProposalSummary(
            lead_id=lead.id,
            business_name=lead.business.name,
            opportunity_id=(op := open_opportunities.get(lead.id)) and op.id,
            tier=op.tier if op else None,
            proposed_price_cents=op.proposed_price_cents if op else None,
            since=lead.updated_at,
        )
        for lead in sorted(proposal_leads, key=lambda lead: lead.updated_at)
    ]

    won_deals_count = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .join(Business, Lead.business_id == Business.id)
            .where(Business.workspace_id == workspace_id, Lead.status == LeadStatus.WON)
        )
        or 0
    )
    lost_deals_count = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .join(Business, Lead.business_id == Business.id)
            .where(Business.workspace_id == workspace_id, Lead.status == LeadStatus.LOST)
        )
        or 0
    )
    decided = won_deals_count + lost_deals_count
    conversion_rate_pct = (won_deals_count / decided * 100) if decided > 0 else None

    lead_in_workspace = (
        select(Lead.id).join(Business, Lead.business_id == Business.id).where(Business.workspace_id == workspace_id)
    )
    estimated_revenue_cents = (
        db.scalar(
            select(func.coalesce(func.sum(SalesOpportunity.proposed_price_cents), 0)).where(
                SalesOpportunity.status == OpportunityStatus.OPEN, SalesOpportunity.lead_id.in_(lead_in_workspace)
            )
        )
        or 0
    )
    actual_revenue_cents = (
        db.scalar(
            select(func.coalesce(func.sum(SalesOpportunity.proposed_price_cents), 0)).where(
                SalesOpportunity.status == OpportunityStatus.WON, SalesOpportunity.lead_id.in_(lead_in_workspace)
            )
        )
        or 0
    )

    recent_won = _deal_summaries(db, workspace_id, OpportunityStatus.WON, order_desc=True)
    recent_lost = _deal_summaries(db, workspace_id, OpportunityStatus.LOST, order_desc=True)

    outreach_activity = _outreach_activity(db, workspace_id, now)

    do_this_next = _build_do_this_next(
        active_leads=active_leads,
        needs_follow_up=needs_follow_up,
        upcoming_meeting_rows=upcoming_meeting_rows,
        proposals=proposals,
        now=now,
    )

    return SalesDashboard(
        new_leads_count=len(new_leads),
        hot_leads_count=len(hot_leads),
        needs_follow_up_count=len(needs_follow_up),
        upcoming_meetings_count=len(upcoming_meetings),
        proposals_count=len(proposals),
        won_deals_count=won_deals_count,
        lost_deals_count=lost_deals_count,
        conversion_rate_pct=conversion_rate_pct,
        estimated_revenue_cents=estimated_revenue_cents,
        actual_revenue_cents=actual_revenue_cents,
        new_leads=[_lead_summary(lead) for lead in new_leads[:RECENT_LIST_LIMIT]],
        hot_leads=[_lead_summary(lead) for lead in hot_leads[:RECENT_LIST_LIMIT]],
        needs_follow_up=needs_follow_up[:RECENT_LIST_LIMIT],
        upcoming_meetings=upcoming_meetings[:RECENT_LIST_LIMIT],
        proposals=proposals[:RECENT_LIST_LIMIT],
        recent_won=recent_won,
        recent_lost=recent_lost,
        outreach_activity=outreach_activity,
        do_this_next=do_this_next,
    )


def _latest_by_lead(
    db: Session, lead_ids: list[uuid.UUID], status: OpportunityStatus
) -> dict[uuid.UUID, SalesOpportunity]:
    if not lead_ids:
        return {}
    rows = db.scalars(
        select(SalesOpportunity)
        .where(SalesOpportunity.lead_id.in_(lead_ids), SalesOpportunity.status == status)
        .distinct(SalesOpportunity.lead_id)
        .order_by(SalesOpportunity.lead_id, SalesOpportunity.created_at.desc())
    )
    return {row.lead_id: row for row in rows}


def _deal_summaries(
    db: Session, workspace_id: uuid.UUID, status: OpportunityStatus, *, order_desc: bool
) -> list[DealSummary]:
    order_col = SalesOpportunity.closed_at.desc() if order_desc else SalesOpportunity.closed_at.asc()
    rows = db.scalars(
        select(SalesOpportunity)
        .join(Lead, SalesOpportunity.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, SalesOpportunity.status == status)
        .options(joinedload(SalesOpportunity.lead).joinedload(Lead.business))
        .order_by(order_col.nulls_last())
        .limit(RECENT_LIST_LIMIT)
    )
    return [
        DealSummary(
            lead_id=o.lead_id,
            business_name=o.lead.business.name,
            proposed_price_cents=o.proposed_price_cents,
            tier=o.tier,
            closed_at=o.closed_at,
        )
        for o in rows
    ]


def _outreach_activity(db: Session, workspace_id: uuid.UUID, now: datetime) -> OutreachActivity:
    window_start = now - OUTREACH_WINDOW
    lead_in_workspace = (
        select(Lead.id).join(Business, Lead.business_id == Business.id).where(Business.workspace_id == workspace_id)
    )

    sent = (
        db.scalar(
            select(func.count()).where(
                Interaction.kind == InteractionKind.OUTREACH_SENT,
                Interaction.occurred_at >= window_start,
                Interaction.lead_id.in_(lead_in_workspace),
            )
        )
        or 0
    )
    replied = (
        db.scalar(
            select(func.count()).where(
                Interaction.kind == InteractionKind.REPLY,
                Interaction.occurred_at >= window_start,
                Interaction.lead_id.in_(lead_in_workspace),
            )
        )
        or 0
    )
    reply_rate_pct = (replied / sent * 100) if sent > 0 else None

    recent_rows = list(
        db.scalars(
            select(Interaction)
            .join(Lead, Interaction.lead_id == Lead.id)
            .join(Business, Lead.business_id == Business.id)
            .where(
                Business.workspace_id == workspace_id,
                Interaction.kind.in_((InteractionKind.OUTREACH_SENT, InteractionKind.REPLY)),
            )
            .options(joinedload(Interaction.lead).joinedload(Lead.business))
            .order_by(Interaction.occurred_at.desc())
            .limit(OUTREACH_RECENT_LIMIT)
        )
    )
    recent = [
        OutreachActivityItem(
            id=i.id,
            lead_id=i.lead_id,
            business_name=i.lead.business.name,
            kind="sent" if i.kind == InteractionKind.OUTREACH_SENT else "replied",
            channel=None,
            occurred_at=i.occurred_at,
            summary=i.summary,
        )
        for i in recent_rows
    ]

    return OutreachActivity(
        sent_last_7_days=sent, replied_last_7_days=replied, reply_rate_pct=reply_rate_pct, recent=recent
    )


def _build_do_this_next(
    *,
    active_leads: list[Lead],
    needs_follow_up: list[FollowUpDue],
    upcoming_meeting_rows: list[Meeting],
    proposals: list[ProposalSummary],
    now: datetime,
) -> list[AttentionItem]:
    scored: list[tuple[int, float, AttentionItem]] = []
    leads_by_id = {lead.id: lead for lead in active_leads}

    for follow_up in needs_follow_up:
        tier = _OVERDUE_FOLLOW_UP if follow_up.overdue else _FOLLOW_UP_DUE_TODAY
        lead = leads_by_id.get(follow_up.lead_id)
        opportunity_bonus = -(lead.score or 0) if lead else 0
        scored.append(
            (
                tier,
                opportunity_bonus,
                AttentionItem(
                    kind="follow_up",
                    label="Follow-up",
                    id=follow_up.lead_id,
                    title=follow_up.business_name,
                    detail="Overdue" if follow_up.overdue else "Due today",
                    action=follow_up.suggested_next_action,
                    href=f"/dashboard/leads/{follow_up.lead_id}",
                ),
            )
        )

    meeting_cutoff = now + IMMINENT_MEETING_WINDOW
    for meeting in upcoming_meeting_rows:
        if meeting.scheduled_at > meeting_cutoff:
            break  # ordered by scheduled_at — nothing after this is imminent either
        scored.append(
            (
                _IMMINENT_MEETING,
                0,
                AttentionItem(
                    kind="meeting",
                    label="Meeting",
                    id=meeting.id,
                    title=meeting.lead.business.name,
                    detail=f"{meeting.title} — {meeting.scheduled_at.strftime('%a %d %b, %H:%M')}",
                    action="Review the meeting brief before you dial in",
                    href="/dashboard/calendar",
                ),
            )
        )

    already_flagged = {item.id for _, _, item in scored if item.kind == "follow_up"}
    for lead in active_leads:
        if lead.id in already_flagged:
            continue
        if lead.status != LeadStatus.QUALIFIED or not _is_hot(lead):
            continue
        has_outreach = any(True for i in lead.interactions if i.kind == InteractionKind.OUTREACH_SENT)
        if has_outreach:
            continue
        scored.append(
            (
                _HOT_LEAD_UNCONTACTED,
                -(lead.score or 0),
                AttentionItem(
                    kind="hot_lead",
                    label="Hot lead",
                    id=lead.id,
                    title=lead.business.name,
                    detail=f"Qualified, high opportunity{f' (score {lead.score})' if lead.score is not None else ''} — no outreach sent yet",
                    action="Draft and send outreach",
                    href=f"/dashboard/leads/{lead.id}",
                ),
            )
        )

    stale_proposal_cutoff = now - PROPOSAL_STALE_AFTER
    for proposal in proposals:
        if proposal.since > stale_proposal_cutoff:
            continue
        days_stale = (now - proposal.since).days
        scored.append(
            (
                _STALE_PROPOSAL,
                -(proposal.proposed_price_cents or 0),
                AttentionItem(
                    kind="stale_proposal",
                    label="Proposal",
                    id=proposal.lead_id,
                    title=proposal.business_name,
                    detail=f"No movement in {days_stale} days since the proposal went out",
                    action="Chase the proposal, or mark it lost",
                    href=f"/dashboard/leads/{proposal.lead_id}",
                ),
            )
        )

    stale_new_cutoff = now - NEW_LEAD_STALE_AFTER
    for lead in active_leads:
        if lead.status != LeadStatus.NEW or lead.created_at > stale_new_cutoff:
            continue
        scored.append(
            (
                _STALE_NEW_LEAD,
                -(lead.score or 0),
                AttentionItem(
                    kind="new_lead",
                    label="New lead",
                    id=lead.id,
                    title=lead.business.name,
                    detail=f"Sitting untriaged since {lead.created_at.date().isoformat()}",
                    action="Research it and qualify, or archive it",
                    href=f"/dashboard/leads/{lead.id}",
                ),
            )
        )

    scored.sort(key=lambda row: (row[0], row[1]))
    return [item for _, _, item in scored[:DO_THIS_NEXT_LIMIT]]
