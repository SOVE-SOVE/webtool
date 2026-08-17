import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.users.models import User
    from app.modules.website_audits.models import WebsiteAudit


class SalesAuditReport(Base):
    """
    A generated Sales Audit report — the 9-section commercial report
    produced by agents/sales_audit.py. One row per generation; a lead
    can accumulate several over time, newest reviewed first.
    """

    __tablename__ = "sales_audit_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    website_audit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("website_audits.id", ondelete="SET NULL")
    )

    # Report sections. List-shaped ones are stored newline-separated —
    # same convention as businesses.social_links, no JSON columns.
    business_summary: Mapped[str] = mapped_column(Text)
    website_strengths: Mapped[str] = mapped_column(Text)
    top_problems: Mapped[str] = mapped_column(Text)
    why_problems_matter: Mapped[str] = mapped_column(Text)
    recommended_improvements: Mapped[str] = mapped_column(Text)
    suggested_structure: Mapped[str] = mapped_column(Text)
    talking_points: Mapped[str] = mapped_column(Text)
    potential_objections: Mapped[str] = mapped_column(Text)
    suggested_offer: Mapped[str] = mapped_column(Text)

    # What the report is grounded in, and traceability per docs/03_AGENT_RULES.md.
    sources_note: Mapped[str | None] = mapped_column(Text)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_notes: Mapped[str | None] = mapped_column(Text)
    model_used: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(50))
    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead: Mapped["Lead"] = relationship(back_populates="sales_audit_reports")
    website_audit: Mapped["WebsiteAudit | None"] = relationship()
    generated_by_user: Mapped["User | None"] = relationship()
