import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.modules.dashboard.schemas import AttentionItem
from app.modules.leads.models import LeadPriority, LeadStatus
from app.modules.outreach.models import OutreachChannel


class LeadSummary(BaseModel):
    id: uuid.UUID
    business_name: str
    status: LeadStatus
    priority: LeadPriority
    score: int | None
    updated_at: datetime
    assigned_user_name: str | None


class FollowUpDue(BaseModel):
    lead_id: uuid.UUID
    business_name: str
    due_date: date
    overdue: bool
    suggested_next_action: str


class MeetingSummary(BaseModel):
    id: uuid.UUID
    lead_id: uuid.UUID
    business_name: str
    title: str
    scheduled_at: datetime


class ProposalSummary(BaseModel):
    """One lead currently at PROPOSAL status. `proposed_price_cents` is
    only ever real money the operator logged via POST
    /leads/{id}/opportunities — null, never guessed, when a lead reached
    PROPOSAL by a direct status edit with no quote logged yet. `since` is
    the lead's own `updated_at`, the same approximation the stale-lead
    detector already uses elsewhere for "how long has this sat here"."""

    lead_id: uuid.UUID
    business_name: str
    opportunity_id: uuid.UUID | None
    tier: str | None
    proposed_price_cents: int | None
    since: datetime


class DealSummary(BaseModel):
    """A closed (won or lost) opportunity. `proposed_price_cents`/`tier`
    are null when the deal closed with no logged opportunity row —
    e.g. a lead marked LOST by a direct status edit rather than through
    the mark-opportunity-lost action."""

    lead_id: uuid.UUID
    business_name: str
    proposed_price_cents: int | None
    tier: str | None
    closed_at: datetime | None


class OutreachActivityItem(BaseModel):
    id: uuid.UUID
    lead_id: uuid.UUID
    business_name: str
    kind: str  # "sent" | "replied"
    channel: OutreachChannel | None
    occurred_at: datetime
    summary: str | None


class OutreachActivity(BaseModel):
    sent_last_7_days: int
    replied_last_7_days: int
    # None rather than 0 when there's nothing sent to divide by — a 0%
    # reply rate and "no sends this week" are different facts, and
    # collapsing them would misreport a quiet week as a bad one.
    reply_rate_pct: float | None
    recent: list[OutreachActivityItem]


class SalesDashboard(BaseModel):
    # Funnel counts — every one a real, currently-true count, not a
    # cumulative "all time" total (see modules/sales_dashboard/service.py
    # for each definition).
    new_leads_count: int
    hot_leads_count: int
    needs_follow_up_count: int
    upcoming_meetings_count: int
    proposals_count: int
    won_deals_count: int
    lost_deals_count: int

    # Of leads with a decided outcome (won or lost) — undecided leads
    # still in flight don't count against or for this. None when nothing
    # has been decided yet.
    conversion_rate_pct: float | None

    # Revenue — see modules/sales_dashboard/service.py's docstring for
    # exactly what each is summed from and why they can never overlap.
    estimated_revenue_cents: int
    actual_revenue_cents: int

    # Lists — the same signals as the counts above, but actionable.
    new_leads: list[LeadSummary]
    hot_leads: list[LeadSummary]
    needs_follow_up: list[FollowUpDue]
    upcoming_meetings: list[MeetingSummary]
    proposals: list[ProposalSummary]
    recent_won: list[DealSummary]
    recent_lost: list[DealSummary]

    outreach_activity: OutreachActivity

    # Ranked "what do I do right now" queue — most urgent/highest-
    # opportunity first. See service.py's _build_do_this_next.
    do_this_next: list[AttentionItem]
