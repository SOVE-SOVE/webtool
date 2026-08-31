import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.integrations.discovery.base import WebsiteStatus
from app.modules.discovery.models import DiscoveredBusinessStatus, DiscoverySearchStatus, OpportunityScoreCategory


class DiscoverySearchCreate(BaseModel):
    """At least one of location/industry/business_type/keywords must be
    set — enforced in the service layer, not here, so the error message
    can name exactly what's missing."""

    query_label: str | None = None
    location: str | None = None
    industry: str | None = None
    business_type: str | None = None
    keywords: str | None = None
    min_score: int | None = None
    max_score: int | None = None
    has_website: bool | None = None
    website_outdated: bool | None = None
    provider: str | None = None


class ScheduleRecurringSearchRequest(DiscoverySearchCreate):
    """Same criteria as a one-off search, plus how often to re-run it."""

    interval_hours: int = 24


class ScheduledSearchRead(BaseModel):
    """The job row backing a scheduled/recurring discovery search — not
    a DiscoverySearch itself, since nothing has run yet."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_type: str
    payload: dict
    run_after: datetime
    created_at: datetime


class DiscoverySearchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    query_label: str | None
    location: str | None
    industry: str | None
    business_type: str | None
    keywords: str | None
    min_score: int | None
    max_score: int | None
    has_website: bool | None
    website_outdated: bool | None
    provider: str
    status: DiscoverySearchStatus
    result_count: int
    error_message: str | None
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    completed_at: datetime | None


class DiscoveredBusinessRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    discovery_search_id: uuid.UUID
    name: str
    industry: str | None
    business_type: str | None
    website_url: str | None
    website_status: WebsiteStatus
    phone: str | None
    email: str | None
    address: str | None
    suburb: str | None
    state: str | None
    postcode: str | None
    social_links: str | None
    source_provider: str
    source_query: str | None
    source_external_id: str | None
    duplicate_of_business_id: uuid.UUID | None
    duplicate_of_discovered_business_id: uuid.UUID | None
    status: DiscoveredBusinessStatus
    opportunity_score: int | None
    score_category: OpportunityScoreCategory | None
    reviewed_by_user_id: uuid.UUID | None
    reviewed_at: datetime | None
    review_notes: str | None
    imported_lead_id: uuid.UUID | None
    discovered_at: datetime
    updated_at: datetime


class DiscoveredBusinessReviewRead(BaseModel):
    """
    One row of the human-review interface (docs/04_ROADMAP.md Lead
    Intelligence stage 5) — DiscoveredBusinessRead's fields plus the
    latest research/quality/score context needed to review a prospect
    without opening its detail page: website audit summary, key
    problems, confidence, a recommended sales angle, and the research
    date. Built by modules/discovery/service.py from the latest row in
    each of the three prior stages — never re-computed here.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    industry: str | None
    suburb: str | None
    state: str | None
    website_url: str | None
    website_status: WebsiteStatus
    status: DiscoveredBusinessStatus
    source_provider: str
    discovered_at: datetime
    imported_lead_id: uuid.UUID | None
    reviewed_by_user_name: str | None
    reviewed_at: datetime | None

    researched_at: datetime | None
    research_error: str | None

    quality_summary: str | None
    key_problems: list[str]

    opportunity_score: int | None
    score_category: OpportunityScoreCategory | None
    confidence: float | None
    recommended_sales_angle: str | None


class BulkApproveRequest(BaseModel):
    business_ids: list[uuid.UUID]


class BulkApproveResult(BaseModel):
    approved: list[DiscoveredBusinessRead]
    not_found: list[uuid.UUID]
