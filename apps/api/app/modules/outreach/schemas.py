import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from app.modules.outreach.models import FollowUpStatus, OutreachChannel, OutreachStatus

SNOOZE_MIN_DAYS = 1
SNOOZE_MAX_DAYS = 30
SNOOZE_DEFAULT_DAYS = 3


def _split(text: str | None) -> list[str]:
    if not text:
        return []
    return [line.strip() for line in text.splitlines() if line.strip()]


class OutreachGenerateRequest(BaseModel):
    channel: OutreachChannel


class OutreachMessageUpdate(BaseModel):
    """
    Operator edit before sending — the "edit everything before it goes
    out" requirement. Only fields relevant to the message's own channel
    are meaningful, but any subset may be sent; unset fields are left
    untouched (see modules/outreach/service.py::update_outreach).
    """

    subject: str | None = None
    body: str | None = None
    opening_line: str | None = None
    key_points: list[str] | None = None
    objection_handling: list[str] | None = None
    suggested_close: str | None = None


class OutreachMessageRead(BaseModel):
    id: uuid.UUID
    lead_id: uuid.UUID
    based_on_sales_audit_id: uuid.UUID | None
    channel: OutreachChannel
    status: OutreachStatus

    subject: str | None
    body: str | None
    opening_line: str | None
    key_points: list[str]
    objection_handling: list[str]
    suggested_close: str | None

    model_used: str
    flagged_for_review: bool = False
    review_notes: str | None = None

    generated_by_user_id: uuid.UUID | None
    generated_by_user_name: str | None
    generated_at: datetime

    approved_by_user_name: str | None
    approved_at: datetime | None
    sent_by_user_name: str | None
    sent_at: datetime | None
    replied_at: datetime | None
    closed_by_user_name: str | None
    closed_at: datetime | None

    @classmethod
    def from_model(cls, m, flagged_for_review: bool = False, review_notes: str | None = None) -> "OutreachMessageRead":
        return cls(
            id=m.id,
            lead_id=m.lead_id,
            based_on_sales_audit_id=m.based_on_sales_audit_id,
            channel=m.channel,
            status=m.status,
            subject=m.subject,
            body=m.body,
            opening_line=m.opening_line,
            key_points=_split(m.key_points),
            objection_handling=_split(m.objection_handling),
            suggested_close=m.suggested_close,
            model_used=m.model_used,
            flagged_for_review=flagged_for_review,
            review_notes=review_notes,
            generated_by_user_id=m.generated_by_user_id,
            generated_by_user_name=m.generated_by_user.name if m.generated_by_user else None,
            generated_at=m.generated_at,
            approved_by_user_name=m.approved_by_user.name if m.approved_by_user else None,
            approved_at=m.approved_at,
            sent_by_user_name=m.sent_by_user.name if m.sent_by_user else None,
            sent_at=m.sent_at,
            replied_at=m.replied_at,
            closed_by_user_name=m.closed_by_user.name if m.closed_by_user else None,
            closed_at=m.closed_at,
        )


class PreviousOutreachSummary(BaseModel):
    id: uuid.UUID
    channel: OutreachChannel
    status: OutreachStatus
    generated_at: datetime
    excerpt: str


class FollowUpRead(BaseModel):
    id: uuid.UUID
    lead_id: uuid.UUID
    business_name: str
    channel: OutreachChannel
    due_date: date
    suggested_next_action: str
    status: FollowUpStatus
    previous_outreach: PreviousOutreachSummary | None

    generated_by_user_name: str | None
    generated_at: datetime
    resolved_by_user_name: str | None
    resolved_at: datetime | None

    @classmethod
    def from_model(cls, f) -> "FollowUpRead":
        return cls(
            id=f.id,
            lead_id=f.lead_id,
            business_name=f.lead.business.name,
            channel=f.channel,
            due_date=f.due_date,
            suggested_next_action=f.suggested_next_action,
            status=f.status,
            previous_outreach=_outreach_summary(f.outreach_message),
            generated_by_user_name=f.generated_by_user.name if f.generated_by_user else None,
            generated_at=f.generated_at,
            resolved_by_user_name=f.resolved_by_user.name if f.resolved_by_user else None,
            resolved_at=f.resolved_at,
        )


class FollowUpBuckets(BaseModel):
    overdue: list[FollowUpRead]
    due_today: list[FollowUpRead]
    upcoming: list[FollowUpRead]


class FollowUpCandidateRead(BaseModel):
    """
    A lead the deterministic detector (modules/outreach/service.py::
    list_needs_follow_up) thinks has gone quiet with nothing scheduled —
    distinct from FollowUpRead, which is an already-scheduled follow-up.
    No LLM involved, so this is cheap enough to compute on every page
    load rather than requiring an explicit "Generate" click first.
    """

    lead_id: uuid.UUID
    business_name: str
    lead_status: str
    reason: str
    suggested_channel: OutreachChannel
    days_quiet: int


class SnoozeFollowUpRequest(BaseModel):
    days: int = Field(default=SNOOZE_DEFAULT_DAYS, ge=SNOOZE_MIN_DAYS, le=SNOOZE_MAX_DAYS)


def _excerpt_for(m) -> str:
    if m.channel in (OutreachChannel.EMAIL, OutreachChannel.FOLLOW_UP):
        return m.subject or "(email, no subject)"
    return m.opening_line or "(talking points)"


def _outreach_summary(m) -> PreviousOutreachSummary | None:
    if m is None:
        return None
    return PreviousOutreachSummary(
        id=m.id,
        channel=m.channel,
        status=m.status,
        generated_at=m.generated_at,
        excerpt=_excerpt_for(m),
    )
