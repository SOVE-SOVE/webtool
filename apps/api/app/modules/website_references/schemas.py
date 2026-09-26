import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# What an operator can say they like about a reference — their own
# observations (a static preview can't show motion), never verified findings.
LikedAspect = Literal["layout", "typography", "colours", "imagery", "navigation", "interaction"]


class WebsiteReferenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    url: str
    name: str
    tags: list[str] = []
    notes: str | None = None
    capture_status: Literal["pending", "captured", "failed"]
    capture_error: str | None = None
    has_screenshot: bool = False
    screenshot_captured_at: datetime | None = None
    archived_at: datetime | None = None
    usage_count: int = 0
    created_at: datetime
    updated_at: datetime


class CreateWebsiteReferenceRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    name: str | None = Field(default=None, max_length=200)
    tags: list[str] = []
    notes: str | None = None


class UpdateWebsiteReferenceRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    tags: list[str] | None = None
    notes: str | None = None


class PlanningReferenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference: WebsiteReferenceRead
    direction: str | None = None
    liked_aspects: list[LikedAspect] = []
    order_index: int = 0


class AttachReferenceRequest(BaseModel):
    reference_id: uuid.UUID


class UpdatePlanningReferenceRequest(BaseModel):
    direction: str | None = None
    liked_aspects: list[LikedAspect] | None = None
