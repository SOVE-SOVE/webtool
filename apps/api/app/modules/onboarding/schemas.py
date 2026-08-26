import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.onboarding.models import OnboardingCategory, OnboardingItemStatus


class OnboardingItemCreate(BaseModel):
    category: OnboardingCategory
    label: str
    notes: str | None = None


class OnboardingItemUpdate(BaseModel):
    status: OnboardingItemStatus | None = None
    notes: str | None = None


class OnboardingItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    category: OnboardingCategory
    label: str
    status: OnboardingItemStatus
    notes: str | None
    is_custom: bool
    sort_order: int
    created_at: datetime


class OnboardingCategoryProgress(BaseModel):
    category: OnboardingCategory
    total: int
    done: int
    not_applicable: int
    # True once every item in the category is either done or marked
    # not-applicable — a category with zero items is never reported (see
    # service.py's _progress_by_category), so this never means "empty".
    complete: bool


class OnboardingChecklistRead(BaseModel):
    project_id: uuid.UUID
    items: list[OnboardingItemRead]
    categories: list[OnboardingCategoryProgress]
    total_items: int
    done_items: int
    not_applicable_items: int
    # 0-100, computed over applicable items only (done / (total -
    # not_applicable)) — a project that's marked every remaining item
    # not-applicable is 100% complete, not stuck below it.
    percent_complete: int
