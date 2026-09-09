import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.website_audits.models import WebsiteAudit


class PlanningStatus(str, enum.Enum):
    READY_TO_ANALYSE = "ready_to_analyse"
    ANALYSING = "analysing"
    COMPLETED = "completed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"


class LeadPlanning(Base):
    """
    "Planning": one standalone workspace per Lead for understanding its
    existing website — separate from the Lead page itself
    (docs/05_DECISIONS.md). "Start Planning" on the Lead creates this
    row (or opens it if it already exists — `lead_id` is unique, so
    there is never more than one per lead); it does NOT run an audit.
    "Analyse Website", a distinct action taken inside Planning, is what
    actually enqueues the background job. Re-analysing updates this
    same row in place (new findings/summary/website_audit_id each time)
    rather than creating a new history entry — the workspace is a
    living thing, not an append-only log.

    `website_url` starts out as whatever the lead's business has on
    record (possibly None) and can be set/overridden here — an operator
    can type one in for a lead that has none, and it need not match
    `business.website_url`. `website_summary` / `operator_notes` are
    freely editable after a run completes; `key_points` is a snapshot
    of the backing WebsiteAudit's findings and always reflects
    `website_audit_id`.
    """

    __tablename__ = "lead_planning"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), unique=True)
    website_url: Mapped[str | None] = mapped_column(String(500))
    website_audit_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("website_audits.id", ondelete="SET NULL"))
    status: Mapped[PlanningStatus] = mapped_column(
        Enum(PlanningStatus, name="planning_status"), default=PlanningStatus.READY_TO_ANALYSE
    )
    website_summary: Mapped[str | None] = mapped_column(Text)
    key_points: Mapped[list] = mapped_column(JSON, default=list)
    operator_notes: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    analysed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    lead: Mapped["Lead"] = relationship()
    website_audit: Mapped["WebsiteAudit | None"] = relationship()
