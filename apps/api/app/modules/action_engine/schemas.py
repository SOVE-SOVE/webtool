import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.action_engine.models import ActionKind


class ActionQueueItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: ActionKind
    entity_type: str
    entity_id: uuid.UUID
    title: str
    detail: str
    action_text: str
    href: str
    urgency_score: int
    opportunity_score: int
    deadline_score: int
    pipeline_value_cents: int
    priority_score: float
    rank: int


class DailyActionQueueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    run_id: uuid.UUID
    workspace_id: uuid.UUID
    generated_at: datetime
    items: list[ActionQueueItemRead]
