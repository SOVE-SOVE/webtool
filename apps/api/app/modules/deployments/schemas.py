import uuid
from datetime import datetime

from pydantic import BaseModel


class CreateDeploymentRequest(BaseModel):
    environment: str = "production"
    notes: str | None = None


class DeploymentRead(BaseModel):
    id: uuid.UUID
    website_id: uuid.UUID
    environment: str
    url: str | None
    status: str
    deployed_at: datetime | None
    approved_by_user_name: str | None
    notes: str | None
    created_at: datetime
