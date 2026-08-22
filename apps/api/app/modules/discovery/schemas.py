import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

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
