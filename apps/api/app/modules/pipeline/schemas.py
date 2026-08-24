import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.leads.models import LeadStatus


class PipelineStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: LeadStatus
    label: str
    sort_order: int
    is_won: bool
    is_lost: bool


class PipelineStageUpdate(BaseModel):
    """Only display config is editable — see PipelineStageConfig's
    docstring for why `key` itself never changes here."""

    label: str | None = None
    sort_order: int | None = None


class PipelineEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lead_id: uuid.UUID | None
    kind: str
    summary: str | None
    created_at: datetime
