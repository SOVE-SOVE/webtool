import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WebsiteAuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lead_id: uuid.UUID
    has_existing_site: bool
    mobile_friendly: bool | None
    https: bool | None
    page_speed_score: int | None
    load_time_ms: int | None
    title: str | None
    meta_description: str | None
    viewport_meta_present: bool | None
    audit_error: str | None
    notes: str | None
    audited_at: datetime
