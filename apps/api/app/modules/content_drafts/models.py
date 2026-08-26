import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class ContentDraftStatus(str, enum.Enum):
    """DRAFT while the operator reviews/edits drafted copy; APPROVED is
    the explicit "this copy is confirmed" gate — mirrors
    CreativeDirectionStatus/SitemapStatus/BriefStatus."""

    DRAFT = "draft"
    APPROVED = "approved"


class ContentDraft(Base):
    """
    AI-drafted website copy (roadmap M4's "Copy drafts generated from
    intake + research, for operator sign-off before build") — one row
    per generation, newest reviewed first, same convention as
    Sitemap/CreativeDirectionBrief/Website. `config` holds
    `{"pages": [...]}`, one entry per sitemap page keyed by `page_id`
    (see agents/content_generator.py's PageContentDraft) — seo title/meta
    description, hero heading/subheading, body, drafted service
    descriptions, drafted FAQ answers, and CTA copy. Small edits
    (modules/content_drafts/service.py) mutate the latest row's `config`
    in place, same as Website's per-section edits; a full regeneration or
    an explicit rollback creates a new row instead.
    """

    __tablename__ = "content_drafts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))

    status: Mapped[ContentDraftStatus] = mapped_column(
        Enum(ContentDraftStatus, name="content_draft_status"), default=ContentDraftStatus.DRAFT
    )
    tone: Mapped[str] = mapped_column(String(30))

    sitemap_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sitemaps.id", ondelete="SET NULL"))
    creative_direction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creative_direction_briefs.id", ondelete="SET NULL")
    )

    config: Mapped[dict | None] = mapped_column(JSON)
    missing_information: Mapped[str | None] = mapped_column(Text)

    # Set only when this version was produced by rolling back to an
    # earlier one (modules/content_drafts/service.py's rollback_content_draft)
    # rather than a fresh generation — traceability for "what did this
    # replace", same idea as Deployment.rollback_of_deployment_id.
    rolled_back_from_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("content_drafts.id", ondelete="SET NULL")
    )

    sources_note: Mapped[str | None] = mapped_column(Text)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_notes: Mapped[str | None] = mapped_column(Text)
    model_used: Mapped[str | None] = mapped_column(String(100))
    prompt_version: Mapped[str | None] = mapped_column(String(50))

    generated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # One-directional on purpose, same reasoning as CreativeDirectionBrief.project
    # / Sitemap.project: keeps this module additive against projects/models.py.
    project: Mapped["Project"] = relationship(viewonly=True)
    generated_by_user: Mapped["User | None"] = relationship(foreign_keys=[generated_by_user_id])
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])
