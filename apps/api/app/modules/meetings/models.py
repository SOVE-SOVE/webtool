import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.sales_opportunities.models import SalesOpportunity


class Meeting(Base):
    """A scheduled or held meeting with notes/outcome. Belongs to a sales opportunity."""

    __tablename__ = "meetings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sales_opportunity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sales_opportunities.id", ondelete="CASCADE")
    )
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    held_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sales_opportunity: Mapped["SalesOpportunity"] = relationship(back_populates="meetings")
