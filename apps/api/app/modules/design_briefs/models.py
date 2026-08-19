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


class BriefStatus(str, enum.Enum):
    """DRAFT while the operator is still collecting/editing intake info;
    APPROVED once it's signed off as the source of truth for design."""

    DRAFT = "draft"
    APPROVED = "approved"


class DesignBrief(Base):
    """
    The structured client intake / project brief — one per project,
    built up field-by-field by the operator from what the client
    supplied. Becomes the source of truth for the build once approved.
    Every field is nullable: an unanswered question stays null rather
    than being guessed at, and DesignBriefRead's `missing_fields`
    reports exactly which ones are still empty.

    List-shaped fields (colours, fonts, testimonials, ...) are stored
    newline-separated in a Text column — same convention as
    businesses.social_links and sales_audit_reports' report sections,
    no JSON columns.
    """

    __tablename__ = "design_briefs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), unique=True
    )
    status: Mapped[BriefStatus] = mapped_column(Enum(BriefStatus, name="brief_status"), default=BriefStatus.DRAFT)

    # --- Business ---
    business_name: Mapped[str | None] = mapped_column(String(255))
    industry: Mapped[str | None] = mapped_column(String(120))
    location: Mapped[str | None] = mapped_column(String(255))
    contact_name: Mapped[str | None] = mapped_column(String(255))
    contact_email: Mapped[str | None] = mapped_column(String(255))
    contact_phone: Mapped[str | None] = mapped_column(String(50))
    business_description: Mapped[str | None] = mapped_column(Text)
    services_products: Mapped[str | None] = mapped_column(Text)
    target_customers: Mapped[str | None] = mapped_column(Text)
    business_goals: Mapped[str | None] = mapped_column(Text)

    # --- Brand ---
    brand_name: Mapped[str | None] = mapped_column(String(255))
    logo_notes: Mapped[str | None] = mapped_column(Text)
    brand_colours: Mapped[str | None] = mapped_column(Text)
    brand_fonts: Mapped[str | None] = mapped_column(Text)
    brand_guidelines: Mapped[str | None] = mapped_column(Text)
    visual_references: Mapped[str | None] = mapped_column(Text)
    existing_social_profiles: Mapped[str | None] = mapped_column(Text)

    # --- Content ---
    about_content: Mapped[str | None] = mapped_column(Text)
    services_content: Mapped[str | None] = mapped_column(Text)
    products_content: Mapped[str | None] = mapped_column(Text)
    content_contact_details: Mapped[str | None] = mapped_column(Text)
    testimonials: Mapped[str | None] = mapped_column(Text)
    faqs: Mapped[str | None] = mapped_column(Text)
    calls_to_action: Mapped[str | None] = mapped_column(Text)

    # --- Website ---
    required_pages: Mapped[str | None] = mapped_column(Text)
    required_functionality: Mapped[str | None] = mapped_column(Text)
    existing_website_url: Mapped[str | None] = mapped_column(String(500))
    domain: Mapped[str | None] = mapped_column(String(255))
    hosting: Mapped[str | None] = mapped_column(Text)
    integrations: Mapped[str | None] = mapped_column(Text)

    # --- Assets ---
    # Reference/notes per item (e.g. "Primary logo — https://drive.google.com/...")
    # rather than actual file storage — no blob storage integration exists
    # in this app yet (see docs/02_ARCHITECTURE.md integrations/).
    logo_assets: Mapped[str | None] = mapped_column(Text)
    image_assets: Mapped[str | None] = mapped_column(Text)
    video_assets: Mapped[str | None] = mapped_column(Text)
    document_assets: Mapped[str | None] = mapped_column(Text)
    existing_copy_assets: Mapped[str | None] = mapped_column(Text)

    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship(back_populates="design_briefs")
    approved_by_user: Mapped["User | None"] = relationship()
