import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.users.models import User
    from app.modules.websites.models import Website


class QaReport(Base):
    """
    Automated or manual technical QA result for a `Website` version
    (agents/technical_qa.py, roadmap M5). One row per run — a website
    version can be re-checked after an edit, and prior reports stay
    reviewable rather than being overwritten, same "newest reviewed
    first" convention as CreativeDirectionBrief/Sitemap/Website.
    `report` holds the full structured result (every check, not just
    the pass/fail summary) as JSON — `passed` here is
    TechnicalQaOutput.ready_for_client_review, not "every check passed"
    (warnings/skips don't block it, only a critical failure does).
    """

    __tablename__ = "qa_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    website_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))  # "automated" | "manual"
    passed: Mapped[bool | None] = mapped_column(Boolean)
    summary: Mapped[str | None] = mapped_column(Text)
    report: Mapped[dict | None] = mapped_column(JSON)
    preview_url: Mapped[str | None] = mapped_column(String(500))
    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Approval checkpoint 5 ("QA") — a human sign-off distinct from
    # `passed` (the automated ready_for_client_review verdict). An
    # operator approves *this specific report*, not just "QA in
    # general"; modules/qa_reports/service.py refuses to approve a
    # report where `passed` is False, so a critical failure can't be
    # rubber-stamped past (docs/05_DECISIONS.md).
    human_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approval_notes: Mapped[str | None] = mapped_column(Text)

    website: Mapped["Website"] = relationship(back_populates="qa_reports")
    generated_by_user: Mapped["User | None"] = relationship(foreign_keys=[generated_by_user_id])
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])
