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


class OnboardingCategory(str, enum.Enum):
    """The fixed set of areas a client onboarding needs to cover. Which
    *items* exist within a category, and whether any given item even
    applies, is per-project — see OnboardingChecklistItem."""

    CLIENT_INFORMATION = "client_information"
    PROJECT_TYPE = "project_type"
    GOALS = "goals"
    TARGET_AUDIENCE = "target_audience"
    SERVICES = "services"
    BRANDING = "branding"
    EXISTING_ASSETS = "existing_assets"
    DOMAIN = "domain"
    HOSTING = "hosting"
    REQUIRED_PAGES = "required_pages"
    FUNCTIONALITY = "functionality"
    CONTENT = "content"
    DEADLINES = "deadlines"
    BUDGET = "budget"
    APPROVALS = "approvals"


class OnboardingItemStatus(str, enum.Enum):
    PENDING = "pending"
    DONE = "done"
    NOT_APPLICABLE = "not_applicable"


class OnboardingChecklistItem(Base):
    """
    One onboarding step for one project. A project's checklist is seeded
    with a starter item per category (see DEFAULT_ONBOARDING_ITEMS in
    service.py) the first time it's touched — same "starting checklist,
    not a fixed workflow" contract as projects/service.py's
    DEFAULT_INTAKE_TASK_TITLES.

    Deliberately NOT one fixed structure for every project: a seeded item
    that doesn't apply here (e.g. "buy a domain" when the client already
    has one) is marked NOT_APPLICABLE rather than forced through, and an
    operator can add project-specific items (`is_custom=True`) on top of
    the starter set. Seeded (non-custom) items are never deleted, only
    marked not-applicable, so the checklist always shows the full set of
    areas an onboarding could cover, even when several don't apply here —
    only a custom item, which the operator themselves added, can be
    removed outright.
    """

    __tablename__ = "onboarding_checklist_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    category: Mapped[OnboardingCategory] = mapped_column(Enum(OnboardingCategory, name="onboarding_category"))
    label: Mapped[str] = mapped_column(String(255))
    status: Mapped[OnboardingItemStatus] = mapped_column(
        Enum(OnboardingItemStatus, name="onboarding_item_status"), default=OnboardingItemStatus.PENDING
    )
    notes: Mapped[str | None] = mapped_column(Text)
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["Project"] = relationship()
