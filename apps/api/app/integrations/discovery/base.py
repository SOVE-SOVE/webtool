"""
The provider adapter contract for business discovery — the interface
requirement from docs/04_ROADMAP.md's Lead Intelligence spec ("design
around provider adapters so external data providers can be swapped
later; do not hard-code a single provider into the business logic").
`modules/discovery/service.py` only ever depends on this module and
`registry.py`, never on a concrete provider — see brave_search_provider.py
for the one adapter built so far, and registry.py for how a future one
(Google Places, ABN Lookup, a directory scrape) plugs in without a
service-layer change.
"""

import enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


class ProviderUnavailableError(Exception):
    """Raised when a provider can't run at all (e.g. missing API key) —
    distinct from a provider that ran and legitimately found nothing."""


class WebsiteStatus(str, enum.Enum):
    """Whether a discovered business has a website — a real tri-state, not
    a boolean. A business with no website is still a valid lead, so the
    distinction that matters is *confirmed* absence vs. *not knowing*:

    - FOUND    — the provider gave us a usable website URL.
    - NONE     — the provider positively reports the business has no
                 website (e.g. a places API with an empty `website`
                 field). Never inferred from a single failed page fetch.
    - UNKNOWN  — the data source can't say either way. The default: a
                 plain web search can't confirm a business has *no* site,
                 only that it didn't surface one.
    """

    FOUND = "found"
    NONE = "none"
    UNKNOWN = "unknown"


class InstagramWebsiteStatus(str, enum.Enum):
    """
    A finer-grained classification than `WebsiteStatus` above, specific
    to an Instagram-sourced candidate (see modules/discovery/instagram_import.py)
    — "does this business have a website" isn't a yes/no for a business
    that primarily operates through Instagram; it matters *what* they
    have instead. Deliberately a separate enum rather than adding values
    to `WebsiteStatus`: every existing provider's logic
    (modules/discovery/service.py's `_apply_website_status`) assumes
    exactly the three generic values, and Postgres enum types are
    awkward to extend in place. An Instagram row still gets a generic
    `WebsiteStatus` too (mapped down — see
    modules/discovery/instagram_import.py's `_generic_status_for`), so
    every existing map/filter/scoring path that only knows the generic
    tri-state keeps working unchanged.

    - NO_WEBSITE            — nothing beyond the Instagram profile itself.
    - LINK_IN_BIO_ONLY      — a Linktree/Beacons/etc. page, not an owned domain.
    - INSTAGRAM_SHOP_ONLY   — Meta's own commerce surface, no owned site.
    - PROPER_WEBSITE        — an owned domain was found and confirmed.
    - UNKNOWN_NEEDS_REVIEW  — can't classify confidently from what's on
                              record. Never guessed into one of the above.
    """

    NO_WEBSITE = "no_website"
    LINK_IN_BIO_ONLY = "link_in_bio_only"
    INSTAGRAM_SHOP_ONLY = "instagram_shop_only"
    PROPER_WEBSITE = "proper_website"
    UNKNOWN_NEEDS_REVIEW = "unknown_needs_review"


# Instagram statuses that mean "no owned website" for every existing
# map/filter/scoring path that only understands the generic tri-state —
# see WebsiteStatus and modules/discovery/instagram_import.py.
INSTAGRAM_NO_OWNED_SITE_STATUSES = frozenset(
    {
        InstagramWebsiteStatus.NO_WEBSITE,
        InstagramWebsiteStatus.LINK_IN_BIO_ONLY,
        InstagramWebsiteStatus.INSTAGRAM_SHOP_ONLY,
    }
)


class LocationConfidence(str, enum.Enum):
    """How much to trust `latitude`/`longitude`/`address` on a
    candidate. A places API's coordinates are CONFIRMED; a location tag
    or an address typed into a CSV import is only APPROXIMATE; no
    location evidence at all is UNKNOWN (never guessed/geocoded)."""

    CONFIRMED = "confirmed"
    APPROXIMATE = "approximate"
    UNKNOWN = "unknown"


@dataclass
class DiscoveryCriteria:
    location: str | None = None
    industry: str | None = None
    business_type: str | None = None
    keywords: str | None = None
    # One page of results: `limit` businesses starting after `offset`
    # already-seen ones. A provider clamps both to what it actually
    # supports (a plain web search only pages so deep) and reports back
    # via DiscoveryPage.has_more.
    limit: int = 20
    offset: int = 0


@dataclass
class NormalizedBusinessResult:
    """
    What every provider must normalize its raw response into, so
    `modules/discovery/service.py` never branches on which provider ran.
    Only `name` is guaranteed — everything else is left `None`/empty
    rather than guessed when a provider's raw data doesn't actually say
    it, per the "no unsupported claims" principle used throughout this
    app (see app/integrations/browser.py).
    """

    name: str
    website_url: str | None = None
    # Confirmed presence/absence of a website — see WebsiteStatus. Left
    # UNKNOWN unless a provider can actually say; a set `website_url`
    # implies FOUND (normalized in modules/discovery/service.py).
    website_status: WebsiteStatus = WebsiteStatus.UNKNOWN
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    country: str | None = None
    # Only set when a provider genuinely has coordinates for this
    # business (a places API, or GeoCoordinates in the site's own
    # schema.org markup) — never geocoded from a name/city.
    latitude: float | None = None
    longitude: float | None = None
    industry: str | None = None
    # A specific category the provider assigns (e.g. a places API's
    # "cafe" / "plumber", or a schema.org LocalBusiness subtype) —
    # finer-grained than `industry`, which is the operator's search term.
    business_category: str | None = None
    social_links: list[str] = field(default_factory=list)
    # The provider's own id/url for this result, for source tracking and
    # cross-search dedup (see modules/discovery/dedup.py).
    source_external_id: str | None = None
    # What the provider actually said, verbatim — traceability, same
    # reasoning as SalesAuditReport.sources_note.
    raw_snippet: str | None = None
    # How much to trust the location fields above — see
    # LocationConfidence. None for a provider that has no concept of
    # this (Places/Brave always give real coordinates or nothing).
    location_confidence: LocationConfidence | None = None

    # Instagram-only fields (see modules/discovery/instagram_import.py) —
    # every other provider leaves all of these None, same "only set what
    # was actually observed" principle as everything else here.
    instagram_handle: str | None = None
    instagram_profile_url: str | None = None
    instagram_profile_image_url: str | None = None
    instagram_bio: str | None = None
    instagram_follower_count: int | None = None
    instagram_last_post_at: datetime | None = None
    instagram_bio_link_url: str | None = None
    instagram_website_status: InstagramWebsiteStatus | None = None


@dataclass
class DiscoveryPage:
    """One page of a discovery run. `has_more` is the provider's honest
    answer to "is it worth asking for the next page" — False once it has
    paged as deep as it can, or the last page came back short."""

    results: list[NormalizedBusinessResult]
    has_more: bool = False


class DiscoveryProvider(Protocol):
    name: str

    def discover(self, criteria: DiscoveryCriteria) -> DiscoveryPage:
        """
        Runs one discovery query for the page described by `criteria`
        (limit + offset) and returns normalized results (possibly empty —
        a real query that found nothing is not an error) plus whether a
        further page is available. Raises `ProviderUnavailableError` if
        the provider can't run at all.
        """
        ...
