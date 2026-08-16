import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ActivityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID | None
    user_name: str | None
    entity_type: str
    entity_id: uuid.UUID
    action: str
    summary: str | None
    created_at: datetime
