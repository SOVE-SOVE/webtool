import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead


class WebsiteAuditStatus(str, enum.Enum):
    SUCCESS = "success"  # site was reached and analyzed (possibly still flagged_for_review)
    BLOCKED = "blocked"  # target was rejected by SSRF protection — see app.integrations.safe_http
    FAILED = "failed"  # ordinary fetch failure (timeout, DNS, connection refused)


class WebsiteAudit(Base):
    """
    Structured audit of a lead's existing website, per docs/01_REQUIREMENTS.md
    stage 3 — produced by app.agents.website_audit. `results_json` is the
    full structured WebsiteAuditOutput (see website_audit_schemas.py);
    the has_existing_site/mobile_friendly/https/page_speed_score columns
    are a denormalized quick-glance summary for list views.
    """

    __tablename__ = "website_audits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(String(500))
    status: Mapped[WebsiteAuditStatus] = mapped_column(Enum(WebsiteAuditStatus, name="website_audit_status"))
    has_existing_site: Mapped[bool] = mapped_column(Boolean, default=False)
    mobile_friendly: Mapped[bool | None] = mapped_column(Boolean)
    https: Mapped[bool | None] = mapped_column(Boolean)
    page_speed_score: Mapped[int | None] = mapped_column(Integer)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text)
    results_json: Mapped[dict] = mapped_column(JSONB)
    report_markdown: Mapped[str] = mapped_column(Text)
    audited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead: Mapped["Lead"] = relationship(back_populates="website_audits")
