import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.projects.models import ProjectStage


class ProjectCreate(BaseModel):
    client_id: uuid.UUID
    name: str
    assigned_user_id: uuid.UUID | None = None


class ProjectUpdate(BaseModel):
    stage: ProjectStage | None = None
    # See leads/schemas.py's LeadUpdate for why this stays a plain
    # optional field: the key must be present at all to change
    # assignment, `null` unassigns.
    assigned_user_id: uuid.UUID | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    client_business_name: str
    name: str
    stage: ProjectStage
    assigned_user_id: uuid.UUID | None
    assigned_user_name: str | None
    created_at: datetime
    updated_at: datetime
