import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead


class WebsiteAudit(Base):
    """Structured audit of a lead's existing website, per docs/01_REQUIREMENTS.md stage 3."""

    __tablename__ = "website_audits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    has_existing_site: Mapped[bool] = mapped_column(Boolean, default=False)
    mobile_friendly: Mapped[bool | None] = mapped_column(Boolean)
    https: Mapped[bool | None] = mapped_column(Boolean)
    page_speed_score: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    audited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead: Mapped["Lead"] = relationship(back_populates="website_audits")
