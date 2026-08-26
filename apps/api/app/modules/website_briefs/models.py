import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class WebsiteBriefStatus(str, enum.Enum):
    """DRAFT until the operator reviews/edits it; APPROVED is the explicit
    "this is the client-facing brief of record" gate — mirrors
    CreativeDirectionStatus/SitemapStatus."""

    DRAFT = "draft"
    APPROVED = "approved"


class WebsiteBrief(Base):
    """
    A generated Website Brief — the single client-facing document rolling
    up project summary, goals, audience, positioning, sitemap, page
    purposes, content requirements, CTA strategy, visual direction,
    functionality, SEO considerations, and technical requirements.
    Assembled by agents/website_brief.py from whatever of the client
    intake brief (`DesignBrief`), reviewed creative direction
    (`CreativeDirectionBrief`), and reviewed sitemap (`Sitemap`) already
    exist for the project — see docs/05_DECISIONS.md for why this is a
    synthesizing rollup rather than a fourth place those fields are
    independently authored.

    One row per generation, newest reviewed first, editable in place
    before approval — same convention as CreativeDirectionBrief/Sitemap.
    `confirmed_requirements` and `ai_suggestions` are the explicit
    "what did the client actually tell us" vs. "what did the AI suggest"
    split the feature requires: every other field below is inherently a
    suggestion unless a line in `confirmed_requirements` says otherwise.
    """

    __tablename__ = "website_briefs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))

    status: Mapped[WebsiteBriefStatus] = mapped_column(
        Enum(WebsiteBriefStatus, name="website_brief_status"), default=WebsiteBriefStatus.DRAFT
    )

    # Which reviewed upstream artifacts (if any) this generation drew on
    # — kept for traceability/re-generation, same reasoning as
    # Sitemap.creative_direction_id.
    creative_direction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creative_direction_briefs.id", ondelete="SET NULL")
    )
    sitemap_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sitemaps.id", ondelete="SET NULL"))

    project_summary: Mapped[str] = mapped_column(Text)
    goals: Mapped[str] = mapped_column(Text)
    target_audience: Mapped[str] = mapped_column(Text)
    positioning: Mapped[str] = mapped_column(Text)
    sitemap_summary: Mapped[str] = mapped_column(Text)
    page_purposes: Mapped[str] = mapped_column(Text)
    content_requirements: Mapped[str] = mapped_column(Text)
    cta_strategy: Mapped[str] = mapped_column(Text)
    visual_direction: Mapped[str] = mapped_column(Text)
    functionality: Mapped[str] = mapped_column(Text)
    seo_considerations: Mapped[str] = mapped_column(Text)
    technical_requirements: Mapped[str] = mapped_column(Text)

    # The FACTS/ASSUMPTIONS-equivalent split this feature specifically
    # requires: confirmed_requirements is pulled verbatim from the
    # client's own intake answers; ai_suggestions explicitly names which
    # sections above are the AI's synthesis rather than a client-
    # confirmed or already-approved-upstream fact.
    confirmed_requirements: Mapped[str] = mapped_column(Text)
    ai_suggestions: Mapped[str] = mapped_column(Text)

    sources_note: Mapped[str | None] = mapped_column(Text)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_notes: Mapped[str | None] = mapped_column(Text)
    model_used: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(50))

    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    edited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # One-directional on purpose, same reasoning as CreativeDirectionBrief.project.
    project: Mapped["Project"] = relationship(viewonly=True)
    generated_by_user: Mapped["User | None"] = relationship(foreign_keys=[generated_by_user_id])
    edited_by_user: Mapped["User | None"] = relationship(foreign_keys=[edited_by_user_id])
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])
