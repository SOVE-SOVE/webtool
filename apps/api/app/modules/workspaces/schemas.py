import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    currency: str
    timezone: str
    created_at: datetime


class WorkspaceUpdate(BaseModel):
    # Partial update: only fields present in the request body are applied
    # (see model_fields_set usage in service.update_workspace) — matches
    # ClientUpdate's convention. name stays effectively-always-sent from
    # today's one settings card; currency/timezone are optional so the
    # new settings card can PATCH just those two without resending name.
    name: str | None = None
    currency: str | None = None
    timezone: str | None = None
