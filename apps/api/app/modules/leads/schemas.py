import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.leads.models import LeadPriority, LeadStatus
from app.modules.review_intelligence.models import ReviewActivityLevel, ReviewSentimentTrend


class LeadCreate(BaseModel):
    """Creates the business and the lead tracking it together — from the
    operator's side, adding a lead means adding a prospect business."""

    business_name: str
    industry: str | None = None
    website_url: str | None = None
    phone: str | None = None
    suburb: str | None = None
    state: str | None = None
    source: str | None = None
    priority: LeadPriority | None = None
    assigned_user_id: uuid.UUID | None = None


class LeadUpdate(BaseModel):
    status: LeadStatus | None = None
    priority: LeadPriority | None = None
    score: int | None = None
    notes: str | None = None
    # None here is ambiguous ("don't touch" vs. "unassign") in a plain
    # optional field, so assignment is only changed when the key is
    # present in the request body at all — see model_fields_set usage
    # in service.update_lead. Sending assigned_user_id: null unassigns.
    assigned_user_id: uuid.UUID | None = None


class LeadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    business_name: str
    industry: str | None
    suburb: str | None
    state: str | None
    # Contact/site details carried through from the business so the Leads
    # list can show "who/where/what site" without a per-row fetch. Read
    # straight off the already-joined Business — no extra query.
    website_url: str | None
    business_email: str | None
    business_phone: str | None
    status: LeadStatus
    priority: LeadPriority
    score: int | None
    source: str | None
    notes: str | None
    archived_at: datetime | None
    assigned_user_id: uuid.UUID | None
    assigned_user_name: str | None
    created_at: datetime
    updated_at: datetime

    # Read-only projection of Google review intelligence from the
    # originating DiscoveredBusiness, when this lead came from Lead
    # Intelligence discovery — see modules/leads/service.py::_to_read.
    # The review_intelligence module remains the sole analysis engine;
    # nothing here is recomputed in the CRM.
    google_rating: float | None = None
    google_review_count: int | None = None
    review_health_score: int | None = None
    review_activity_level: ReviewActivityLevel | None = None
    review_frequency_per_month: float | None = None
    review_sentiment_trend: ReviewSentimentTrend | None = None
    positive_review_themes: list[str] = []
    negative_review_themes: list[str] = []
    review_summary: str | None = None
    review_data_updated_at: datetime | None = None
