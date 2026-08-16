import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BusinessCreate(BaseModel):
    name: str
    industry: str | None = None
    website_url: str | None = None
    phone: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    abn: str | None = None


class BusinessRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    industry: str | None
    website_url: str | None
    phone: str | None
    suburb: str | None
    state: str | None
    postcode: str | None
    abn: str | None
    created_at: datetime
    updated_at: datetime
