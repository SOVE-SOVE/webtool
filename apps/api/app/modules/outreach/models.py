import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.sales_audits.models import SalesAuditReport
    from app.modules.users.models import User


class OutreachChannel(str, enum.Enum):
    EMAIL = "email"
    PHONE = "phone"
    IN_PERSON = "in_person"
    # A drafted follow-up MESSAGE (subject/body, like EMAIL) — distinct from
    # FollowUp.channel below, which recommends the next touch's channel and
    # is never itself "follow_up". Only valid on OutreachMessage.channel.
    FOLLOW_UP = "follow_up"


class OutreachStatus(str, enum.Enum):
    """
    docs/03_AGENT_RULES.md: drafting is autonomous, everything past it is
    an explicit operator action recorded here — the system never moves a
    message out of DRAFTED on its own. FOLLOW_UP_DUE is set when a follow
    up is generated against this message (see FollowUp below), not on a
    timer — there's no background scheduler in this app.
    """

    DRAFTED = "drafted"
    APPROVED = "approved"
    SENT = "sent"
    REPLIED = "replied"
    FOLLOW_UP_DUE = "follow_up_due"
    CLOSED = "closed"


class OutreachMessage(Base):
    """
    A drafted outreach message or talking-points sheet for a lead.
    `subject`/`body` are used for EMAIL; `opening_line`/`key_points`/
    `objection_handling`/`suggested_close` for PHONE and IN_PERSON — see
    agents/outreach.py. One row per generation; a lead can accumulate
    several over time as the conversation progresses.
    """

    __tablename__ = "outreach_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    based_on_sales_audit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sales_audit_reports.id", ondelete="SET NULL")
    )

    channel: Mapped[OutreachChannel] = mapped_column(Enum(OutreachChannel, name="outreach_channel"))
    status: Mapped[OutreachStatus] = mapped_column(
        Enum(OutreachStatus, name="outreach_status"), default=OutreachStatus.DRAFTED
    )

    # EMAIL
    subject: Mapped[str | None] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text)
    # PHONE / IN_PERSON — key_points and objection_handling are newline-
    # separated, same convention as sales_audit_reports' list sections.
    opening_line: Mapped[str | None] = mapped_column(Text)
    key_points: Mapped[str | None] = mapped_column(Text)
    objection_handling: Mapped[str | None] = mapped_column(Text)
    suggested_close: Mapped[str | None] = mapped_column(Text)

    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_notes: Mapped[str | None] = mapped_column(Text)

    model_used: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(50))

    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sent_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    closed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lead: Mapped["Lead"] = relationship(back_populates="outreach_messages")
    based_on_sales_audit: Mapped["SalesAuditReport | None"] = relationship()
    generated_by_user: Mapped["User | None"] = relationship(foreign_keys=[generated_by_user_id])
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])
    sent_by_user: Mapped["User | None"] = relationship(foreign_keys=[sent_by_user_id])
    closed_by_user: Mapped["User | None"] = relationship(foreign_keys=[closed_by_user_id])
    follow_ups: Mapped[list["FollowUp"]] = relationship(back_populates="outreach_message")


class FollowUpStatus(str, enum.Enum):
    PENDING = "pending"
    DONE = "done"


class FollowUp(Base):
    """
    A scheduled next touch on a lead. `due_date` drives the overdue/due-
    today/upcoming buckets at read time (see modules/outreach/service.py)
    — there's no stored bucket, it's always computed against "today".
    """

    __tablename__ = "follow_ups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    outreach_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("outreach_messages.id", ondelete="SET NULL")
    )

    channel: Mapped[OutreachChannel] = mapped_column(Enum(OutreachChannel, name="outreach_channel"))
    due_date: Mapped[date] = mapped_column(Date)
    suggested_next_action: Mapped[str] = mapped_column(Text)
    status: Mapped[FollowUpStatus] = mapped_column(
        Enum(FollowUpStatus, name="follow_up_status"), default=FollowUpStatus.PENDING
    )

    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_notes: Mapped[str | None] = mapped_column(Text)

    model_used: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(50))
    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lead: Mapped["Lead"] = relationship(back_populates="follow_ups")
    outreach_message: Mapped["OutreachMessage | None"] = relationship(back_populates="follow_ups")
    generated_by_user: Mapped["User | None"] = relationship(foreign_keys=[generated_by_user_id])
    resolved_by_user: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_user_id])
