import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.integrations.discovery.base import InstagramWebsiteStatus, LocationConfidence, WebsiteStatus
from app.modules.discovery.models import DiscoveredBusinessStatus, DiscoverySearchStatus, OpportunityScoreCategory
from app.modules.review_intelligence.models import ReviewActivityLevel


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
    # Instagram Search Discovery only: `location` split on commas at
    # request time (see service.py's _parse_instagram_search_suburbs) —
    # up to base.py::MAX_SUBURBS_PER_SEARCH entries. Null for every
    # other provider, which only ever uses `location` as free text.
    suburbs: list[str] | None
    # Instagram Search Discovery only: index into `suburbs` the next
    # "load more" will fetch from (0 for every other provider, and once
    # a search has no more suburbs left) — lets the UI show precise
    # "suburb N of M" progress rather than just a plain has_more flag.
    next_suburb_index: int
    status: DiscoverySearchStatus
    result_count: int
    # Whether a "load more" would fetch further results — see the
    # discovery service's pagination bookkeeping.
    has_more: bool
    # Live-query / cache-hit spend for this search (instagram_search
    # only — every other provider leaves both at 0). See
    # DiscoveryPage's docstring.
    queries_used: int
    cache_hits: int
    # How many raw Brave results have been examined vs. how many turned
    # into candidates (result_count) — instagram_search only; 0 for
    # every other provider. See DiscoveryPage.raw_results_checked.
    raw_results_checked: int
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
    country: str | None
    business_category: str | None
    latitude: float | None
    longitude: float | None
    location_confidence: LocationConfidence | None
    social_links: str | None
    source_provider: str
    source_query: str | None
    source_external_id: str | None
    raw_snippet: str | None
    duplicate_of_business_id: uuid.UUID | None
    duplicate_of_discovered_business_id: uuid.UUID | None
    status: DiscoveredBusinessStatus
    opportunity_score: int | None
    score_category: OpportunityScoreCategory | None
    google_rating: float | None
    google_review_count: int | None
    review_health_score: int | None
    review_activity_level: ReviewActivityLevel | None
    reviewed_by_user_id: uuid.UUID | None
    reviewed_at: datetime | None
    review_notes: str | None
    imported_lead_id: uuid.UUID | None
    discovered_at: datetime
    updated_at: datetime

    # Instagram-only — null for every business found via another
    # provider. See InstagramWebsiteStatus's docstring.
    instagram_handle: str | None
    instagram_profile_url: str | None
    instagram_profile_image_url: str | None
    instagram_bio: str | None
    instagram_follower_count: int | None
    instagram_last_post_at: datetime | None
    instagram_bio_link_url: str | None
    instagram_website_status: InstagramWebsiteStatus | None
    # When the manual "check for website" action last ran — null if it
    # never has. See modules/discovery/service.py::check_instagram_website.
    instagram_website_checked_at: datetime | None


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
    business_category: str | None
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

    instagram_handle: str | None
    instagram_website_status: InstagramWebsiteStatus | None
    instagram_website_checked_at: datetime | None
    raw_snippet: str | None

    researched_at: datetime | None
    research_error: str | None

    quality_summary: str | None
    key_problems: list[str]

    opportunity_score: int | None
    score_category: OpportunityScoreCategory | None
    confidence: float | None
    recommended_sales_angle: str | None

    google_rating: float | None
    google_review_count: int | None
    review_health_score: int | None
    review_activity_level: ReviewActivityLevel | None


class ApproveResult(BaseModel):
    """
    The outcome of approving a discovered business. Approval brings the
    business into the CRM in the same step (no separate "add to CRM"
    action), so this always carries the resulting review row plus:
    - outcome "imported": a new CRM lead was created for it.
    - outcome "already_in_crm": the business was already represented by a
      CRM lead (existing dedup match) — no duplicate was created and
      `lead_id` points at that existing lead.
    """

    business: DiscoveredBusinessRead
    outcome: Literal["imported", "already_in_crm"]
    lead_id: uuid.UUID | None


class BulkApproveRequest(BaseModel):
    business_ids: list[uuid.UUID]


class BulkApproveFailure(BaseModel):
    id: uuid.UUID
    name: str
    reason: str


class BulkApproveResult(BaseModel):
    """Bulk approve = approve + add-to-CRM for each selection. Buckets the
    outcomes so the UI can say "N added, M already in the CRM, K couldn't
    be added"."""

    imported: list[DiscoveredBusinessRead]
    already_in_crm: list[DiscoveredBusinessRead]
    failed: list[BulkApproveFailure]
    not_found: list[uuid.UUID]


class InstagramImportRequest(BaseModel):
    """Phase 1 of Instagram Discovery — a batch of manually-collected
    candidates as CSV text (see modules/discovery/instagram_import.py
    for the accepted columns). Not a `DiscoveryProvider` search: there's
    no live query to re-run, so this is a one-shot import rather than
    something `load_more` ever applies to."""

    query_label: str | None = None
    csv_text: str


class InstagramImportRowError(BaseModel):
    row_number: int
    reason: str


class InstagramImportResult(BaseModel):
    """The outcome of one CSV import — a `DiscoverySearch` was still
    created (provider="instagram_import") so the batch shows up
    everywhere a search does (map, results list, "load more" correctly
    disabled), plus how many rows succeeded/were skipped and why."""

    search: DiscoverySearchRead
    created_count: int
    duplicate_count: int
    skipped_rows: list[InstagramImportRowError]
    truncated: bool
