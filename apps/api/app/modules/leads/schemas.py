import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.leads.models import LeadStage


class LeadCreate(BaseModel):
    """Creates the business and the lead tracking it together — from the
    operator's side, adding a lead means adding a prospect business."""

    business_name: str
    industry: str | None = None
    website_url: str | None = None
    phone: str | None = None
    suburb: str | None = None
    state: str | None = None
    source: str | None = None


class LeadUpdate(BaseModel):
    stage: LeadStage | None = None
    score: int | None = None


class LeadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    business_name: str
    industry: str | None
    suburb: str | None
    state: str | None
    stage: LeadStage
    score: int | None
    source: str | None
    created_at: datetime
    updated_at: datetime
