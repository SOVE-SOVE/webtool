import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator


class TaskCreate(BaseModel):
    title: str
    due_at: datetime | None = None
    project_id: uuid.UUID | None = None
    lead_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _exactly_one_parent(self) -> "TaskCreate":
        if bool(self.project_id) == bool(self.lead_id):
            raise ValueError("Provide exactly one of project_id or lead_id")
        return self


class TaskUpdate(BaseModel):
    done: bool


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    done: bool
    due_at: datetime | None
    project_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    context: str
    created_at: datetime
