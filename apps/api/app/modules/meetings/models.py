import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class MeetingType(str, enum.Enum):
    SALES_CALL = "sales_call"
    CLIENT_CHECK_IN = "client_check_in"
    OTHER = "other"


class MeetingStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    HELD = "held"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class Meeting(Base):
    """
    A scheduled or held meeting. Belongs to exactly one of a project
    (post-sale client check-ins) or a lead (sales-side calls), mirroring
    Task's dual-parent pattern — see docs/05_DECISIONS.md for why this
    isn't scoped to sales_opportunity as originally documented.
    """

    __tablename__ = "meetings"
    __table_args__ = (
        CheckConstraint(
            "(project_id IS NOT NULL)::int + (lead_id IS NOT NULL)::int = 1",
            name="meeting_belongs_to_exactly_one_parent",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(255))
    meeting_type: Mapped[MeetingType] = mapped_column(
        Enum(MeetingType, name="meeting_type"), default=MeetingType.OTHER
    )
    status: Mapped[MeetingStatus] = mapped_column(
        Enum(MeetingStatus, name="meeting_status"), default=MeetingStatus.SCHEDULED
    )
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    held_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(String(120))
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # The synced Google Calendar event id, if the assigned user has a
    # connected calendar — see integrations/google_calendar.py. Null
    # means either not synced yet, sync failed (non-fatal, see
    # modules/meetings/service.py), or no calendar connected.
    external_event_id: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["Project | None"] = relationship(back_populates="meetings")
    lead: Mapped["Lead | None"] = relationship()
    assigned_user: Mapped["User | None"] = relationship()
    # meeting_briefs.meeting_id is NOT NULL — service.delete_meeting
    # deletes a loaded brief explicitly before deleting the meeting,
    # since the ORM's default delete-parent behavior (null the child FK)
    # would otherwise violate that constraint.
    brief: Mapped["MeetingBrief | None"] = relationship(back_populates="meeting", uselist=False)


class MeetingBrief(Base):
    """
    Auto-generated meeting prep, synthesized from existing lead
    information (business record, latest sales audit, prior outreach,
    prior interactions) when a lead-side meeting is booked, or on
    demand via POST /meetings/{id}/brief — see agents/meeting_brief.py
    and modules/meetings/service.py. One per meeting, overwritten on
    regeneration; project-side (client check-in) meetings don't get
    one, per the requested workflow (INTERESTED LEAD -> ... -> MEETING
    BRIEF).

    BUSINESS/WEBSITE/SALES fields and possible_package/
    suggested_pricing_range are a frozen, deterministic snapshot of
    stored records at generation time — never LLM output, so there is
    nothing here for a model to invent. Only discovery_questions and
    likely_requirements come from the LLM (agents/meeting_brief.py).
    All list-shaped fields are newline-separated, per
    businesses.social_links convention.
    """

    __tablename__ = "meeting_briefs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), unique=True)

    # BUSINESS
    business_name: Mapped[str] = mapped_column(String(255))
    business_industry: Mapped[str | None] = mapped_column(String(120))
    business_location: Mapped[str | None] = mapped_column(String(255))
    business_website: Mapped[str | None] = mapped_column(String(500))

    # WEBSITE — from the latest Sales Audit, if one exists
    website_strengths: Mapped[str] = mapped_column(Text)
    website_weaknesses: Mapped[str] = mapped_column(Text)
    website_opportunities: Mapped[str] = mapped_column(Text)

    # SALES
    lead_score: Mapped[int | None] = mapped_column(Integer)
    previous_interactions: Mapped[str] = mapped_column(Text)
    outreach_history: Mapped[str] = mapped_column(Text)
    objections: Mapped[str] = mapped_column(Text)

    # DISCOVERY
    questions_to_ask: Mapped[str] = mapped_column(Text)
    likely_requirements: Mapped[str] = mapped_column(Text)
    possible_package: Mapped[str] = mapped_column(Text)
    suggested_pricing_range: Mapped[str] = mapped_column(Text)

    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_notes: Mapped[str | None] = mapped_column(Text)
    model_used: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(50))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    meeting: Mapped["Meeting"] = relationship(back_populates="brief")
