import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.modules.website_feedback.models import FeedbackStatus, FeedbackType


class FeedbackCreate(BaseModel):
    feedback_type: FeedbackType
    message: str = Field(min_length=1, max_length=5000)
    # Where on the site the feedback applies — both optional, since
    # APPROVAL/REJECTION/GENERAL feedback is about the whole version,
    # not one spot on one page.
    page_slug: str | None = None
    section_id: str | None = None
    client_name: str | None = Field(default=None, max_length=200)
    client_email: str | None = Field(default=None, max_length=320)


class FeedbackRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    website_id: uuid.UUID
    feedback_type: FeedbackType
    message: str
    page_slug: str | None
    section_id: str | None
    client_name: str | None
    client_email: str | None
    status: FeedbackStatus
    resolved_by_user_name: str | None
    resolved_at: datetime | None
    resolution_notes: str | None
    created_at: datetime


class FeedbackStatusUpdate(BaseModel):
    status: FeedbackStatus
    resolution_notes: str | None = None
