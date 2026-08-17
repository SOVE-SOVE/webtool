import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.projects.models import Project


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
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    held_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["Project | None"] = relationship(back_populates="meetings")
    lead: Mapped["Lead | None"] = relationship()
