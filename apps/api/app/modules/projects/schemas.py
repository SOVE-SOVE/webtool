import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.projects.models import ProjectStage


class ProjectCreate(BaseModel):
    client_id: uuid.UUID
    name: str


class ProjectUpdate(BaseModel):
    stage: ProjectStage


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    client_business_name: str
    name: str
    stage: ProjectStage
    created_at: datetime
    updated_at: datetime
