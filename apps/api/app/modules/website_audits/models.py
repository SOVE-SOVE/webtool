import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
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
    # Deliberately never populated by the Sales Audit feature — a 0-100
    # score implies real Lighthouse methodology we don't run. load_time_ms
    # below is the real, measured evidence instead. Left for a future
    # dedicated page-speed integration.
    page_speed_score: Mapped[int | None] = mapped_column(Integer)
    load_time_ms: Mapped[int | None] = mapped_column(Integer)
    title: Mapped[str | None] = mapped_column(String(500))
    meta_description: Mapped[str | None] = mapped_column(Text)
    viewport_meta_present: Mapped[bool | None] = mapped_column(Boolean)
    audit_error: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    audited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead: Mapped["Lead"] = relationship(back_populates="website_audits")
