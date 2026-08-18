import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.modules.projects.models import ProjectStage


class ProjectCreate(BaseModel):
    client_id: uuid.UUID
    name: str
    assigned_user_id: uuid.UUID | None = None
    # The agreed terms of this project's engagement — optional here since
    # a manually-added project (not from a lead conversion) may not have
    # them yet. See app/modules/clients/schemas.py's ClientCreate for the
    # conversion path, which sets these directly.
    package: str | None = None
    price_cents: int | None = None
    deadline: date | None = None


class ProjectUpdate(BaseModel):
    stage: ProjectStage | None = None
    # See leads/schemas.py's LeadUpdate for why this stays a plain
    # optional field: the key must be present at all to change
    # assignment, `null` unassigns.
    assigned_user_id: uuid.UUID | None = None
    package: str | None = None
    price_cents: int | None = None
    deadline: date | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    client_business_name: str
    source_lead_id: uuid.UUID | None
    name: str
    stage: ProjectStage
    package: str | None
    price_cents: int | None
    deadline: date | None
    assigned_user_id: uuid.UUID | None
    assigned_user_name: str | None
    created_at: datetime
    updated_at: datetime
