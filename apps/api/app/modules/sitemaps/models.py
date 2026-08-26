import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class SitemapStatus(str, enum.Enum):
    """DRAFT while the operator is reviewing/editing the generated
    structure; APPROVED is the explicit "this is the structural source of
    truth for website generation" gate — mirrors CreativeDirectionStatus
    (modules/creative_directions/models.py) and BriefStatus."""

    DRAFT = "draft"
    APPROVED = "approved"


class PageType(str, enum.Enum):
    """The common page archetypes this system knows about (roadmap M4's
    sitemap/planning feature). Not every sitemap uses every type — the
    generating agent and the operator both pick only what fits the
    specific business. CUSTOM covers anything else (e.g. a restaurant's
    Menu page, a booking page)."""

    HOME = "home"
    ABOUT = "about"
    SERVICES = "services"
    SERVICE_DETAIL = "service_detail"
    PRODUCTS = "products"
    PRODUCT_DETAIL = "product_detail"
    CONTACT = "contact"
    FAQ = "faq"
    TESTIMONIALS = "testimonials"
    PORTFOLIO = "portfolio"
    BLOG = "blog"
    BLOG_POST = "blog_post"
    CUSTOM = "custom"


class NavPlacement(str, enum.Enum):
    """Where a page shows up in site navigation — the "navigation
    relationships" the sitemap is required to define, alongside the
    parent/child nesting captured by SitemapPage.parent_page_id."""

    PRIMARY_NAV = "primary_nav"
    FOOTER_NAV = "footer_nav"
    PRIMARY_AND_FOOTER = "primary_and_footer"
    NOT_IN_NAV = "not_in_nav"


class Sitemap(Base):
    """
    A generated/curated website structure — one row per generation; a
    project can accumulate several over time (regenerated as the brief/
    creative direction change), newest reviewed first, same convention as
    CreativeDirectionBrief. The pages themselves live in SitemapPage, a
    real child table (not a newline-separated Text column like most other
    brief-shaped data in this app) because the operator must be able to
    individually add/edit/remove/reorder pages, not just replace a block
    of text wholesale.
    """

    __tablename__ = "sitemaps"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))

    status: Mapped[SitemapStatus] = mapped_column(Enum(SitemapStatus, name="sitemap_status"), default=SitemapStatus.DRAFT)

    # The agent's rationale for the overall structure — why these pages
    # and not others, per the "don't blindly generate every page"
    # requirement. Null for a sitemap that was hand-built with no
    # generation step.
    overview: Mapped[str | None] = mapped_column(Text)

    creative_direction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("creative_direction_briefs.id", ondelete="SET NULL")
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

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # One-directional on purpose, same reasoning as CreativeDirectionBrief.project:
    # keeps this module additive against projects/models.py.
    project: Mapped["Project"] = relationship(viewonly=True)
    generated_by_user: Mapped["User | None"] = relationship(foreign_keys=[generated_by_user_id])
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])

    pages: Mapped[list["SitemapPage"]] = relationship(
        back_populates="sitemap", cascade="all, delete-orphan", order_by="SitemapPage.order_index"
    )


class SitemapPage(Base):
    """
    One page within a Sitemap. `parent_page_id` captures nesting (e.g. a
    SERVICE_DETAIL page under the SERVICES page) and `order_index` the
    sibling order within that parent — together these are what the
    operator changes when reordering. List-shaped fields (key_sections,
    required_content, required_functionality) use the same
    newline-separated Text convention as design_briefs/creative_directions,
    not a JSON column.
    """

    __tablename__ = "sitemap_pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sitemap_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sitemaps.id", ondelete="CASCADE"))
    parent_page_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sitemap_pages.id", ondelete="SET NULL"))

    title: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(255))
    page_type: Mapped[PageType] = mapped_column(Enum(PageType, name="sitemap_page_type"), default=PageType.CUSTOM)
    nav_placement: Mapped[NavPlacement] = mapped_column(
        Enum(NavPlacement, name="sitemap_nav_placement"), default=NavPlacement.PRIMARY_NAV
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    purpose: Mapped[str] = mapped_column(Text)
    # Null when this page targets the same audience as the sitemap's
    # overall target audience — only set when a specific page's audience
    # is narrower/different (see agents/prompts/sitemap.md).
    target_audience: Mapped[str | None] = mapped_column(Text)
    primary_cta: Mapped[str | None] = mapped_column(String(255))
    secondary_cta: Mapped[str | None] = mapped_column(String(255))
    # The business outcome this page should drive — distinct from
    # primary_cta (the literal button/action label).
    conversion_goal: Mapped[str | None] = mapped_column(Text)
    # The real-world search intent this page should capture.
    seo_intent: Mapped[str | None] = mapped_column(Text)
    key_sections: Mapped[str | None] = mapped_column(Text)
    required_content: Mapped[str | None] = mapped_column(Text)
    # Non-text media (photos, logos, video) this page needs — kept
    # separate from required_content, which is written/informational.
    required_assets: Mapped[str | None] = mapped_column(Text)
    required_functionality: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sitemap: Mapped["Sitemap"] = relationship(back_populates="pages", foreign_keys=[sitemap_id])
    parent_page: Mapped["SitemapPage | None"] = relationship(remote_side=[id])
