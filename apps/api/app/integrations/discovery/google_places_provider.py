"""
Business discovery via the Google Places API (New) — Text Search.

Unlike `brave_search_provider` (which searches the *web* and can only
ever return pages that exist), this is a real places source: it returns
structured businesses, including ones with no website. A business with
no `websiteUri` on its Places record is kept, with
`website_status = NONE` — Google's silence on a website, for a curated
listing, is meaningful (see integrations/places.py).

Plugs into the same adapter contract as every other provider
(`DiscoveryProvider` in base.py); the service layer never references it
directly — see registry.py.
"""

from app.integrations import places
from app.integrations.discovery.base import (
    DiscoveryCriteria,
    DiscoveryPage,
    NormalizedBusinessResult,
    ProviderUnavailableError,
    WebsiteStatus,
)

# Google Places Text Search returns at most 20 per page and 3 pages
# total (~60 results) — the ceiling this provider paginates within.
_PAGE_SIZE = 20
_MAX_OFFSET = 2


def _build_query(criteria: DiscoveryCriteria) -> str:
    parts = [criteria.industry, criteria.business_type, criteria.keywords, criteria.location]
    return " ".join(p.strip() for p in parts if p and p.strip())


def _page_at(query: str, offset: int) -> places.PlacesPage | None:
    """Walk `nextPageToken` `offset` times to reach the requested page.
    Returns None if the provider is unavailable, an empty page if the
    query ran out of results before `offset`."""
    token: str | None = None
    for i in range(offset + 1):
        page = places.text_search(query, page_size=_PAGE_SIZE, page_token=token)
        if page is None:
            return None
        if i == offset:
            return page
        token = page.next_page_token
        if not token:
            return places.PlacesPage(results=[], next_page_token=None)
    return None  # unreachable


class GooglePlacesDiscoveryProvider:
    name = "google_places"

    def discover(self, criteria: DiscoveryCriteria) -> DiscoveryPage:
        query = _build_query(criteria)
        if not query:
            return DiscoveryPage(results=[], has_more=False)

        offset = max(0, min(criteria.offset, _MAX_OFFSET))
        page = _page_at(query, offset)
        if page is None:
            raise ProviderUnavailableError(
                "Google Places is unavailable — GOOGLE_PLACES_API_KEY may be unset, or the request failed"
            )

        normalized = [_normalize(p, criteria) for p in page.results]
        has_more = bool(page.next_page_token) and offset < _MAX_OFFSET
        return DiscoveryPage(results=normalized[: criteria.limit], has_more=has_more)


def _normalize(p: places.PlaceResult, criteria: DiscoveryCriteria) -> NormalizedBusinessResult:
    return NormalizedBusinessResult(
        name=p.name[:255],
        website_url=p.website_url,
        # A real websiteUri => HAS_WEBSITE; a Places record without one
        # => NO_WEBSITE (a curated directory that has the business but no
        # site). Never UNKNOWN here — that's for sources that genuinely
        # can't say.
        website_status=WebsiteStatus.FOUND if p.website_url else WebsiteStatus.NONE,
        phone=p.phone,
        address=p.formatted_address,
        suburb=p.suburb,
        state=p.state,
        postcode=p.postcode,
        country=p.country,
        latitude=p.latitude,
        longitude=p.longitude,
        industry=criteria.industry,
        business_category=p.category,
        # The Google place id — a stable cross-search dedup key.
        source_external_id=p.place_id,
        social_links=[],
    )
