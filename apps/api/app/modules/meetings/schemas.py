import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator


class MeetingCreate(BaseModel):
    title: str
    scheduled_at: datetime
    project_id: uuid.UUID | None = None
    lead_id: uuid.UUID | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _exactly_one_parent(self) -> "MeetingCreate":
        if bool(self.project_id) == bool(self.lead_id):
            raise ValueError("Provide exactly one of project_id or lead_id")
        return self


class MeetingUpdate(BaseModel):
    title: str | None = None
    scheduled_at: datetime | None = None
    held_at: datetime | None = None
    notes: str | None = None
    outcome: str | None = None


class MeetingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    scheduled_at: datetime
    held_at: datetime | None
    notes: str | None
    outcome: str | None
    project_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    context: str
    created_at: datetime
