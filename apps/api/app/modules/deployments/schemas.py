import uuid
from datetime import datetime

from pydantic import BaseModel


class CreateDeploymentRequest(BaseModel):
    environment: str = "production"
    notes: str | None = None


class RollbackDeploymentRequest(BaseModel):
    # The prior *successful* deployment to re-publish — its website
    # version is what actually gets redeployed, not necessarily the
    # project's current latest version.
    target_deployment_id: uuid.UUID
    notes: str | None = None


class DeploymentRead(BaseModel):
    id: uuid.UUID
    website_id: uuid.UUID
    environment: str
    target: str
    url: str | None
    status: str
    result: dict | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    deployed_at: datetime | None
    rollback_of_deployment_id: uuid.UUID | None
    approved_by_user_name: str | None
    notes: str | None
    created_at: datetime
