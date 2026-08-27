import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RequestRevisionRequest(BaseModel):
    requested_change: str = Field(min_length=1)
    # The section this feedback targets. Required for any feedback that
    # isn't a spacing request — see modules/website_revisions/service.py
    # for why guessing a target for subjective content feedback isn't
    # done here.
    section_id: str | None = None


class DecisionRequest(BaseModel):
    notes: str | None = None


class WebsiteRevisionRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    revision_number: int
    kind: str
    status: str

    section_id: str | None
    section_type: str | None
    page_name: str | None

    requested_change: str
    generated_change: str

    previous_website_id: uuid.UUID | None
    resulting_website_id: uuid.UUID | None

    created_by_user_id: uuid.UUID | None
    created_by_user_name: str | None
    created_at: datetime

    decided_by_user_name: str | None
    decided_at: datetime | None
    decision_notes: str | None
