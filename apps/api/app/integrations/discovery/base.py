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


@dataclass
class DiscoveryCriteria:
    location: str | None = None
    industry: str | None = None
    business_type: str | None = None
    keywords: str | None = None
    limit: int = 20


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
    industry: str | None = None
    social_links: list[str] = field(default_factory=list)
    # The provider's own id/url for this result, for source tracking and
    # cross-search dedup (see modules/discovery/dedup.py).
    source_external_id: str | None = None
    # What the provider actually said, verbatim — traceability, same
    # reasoning as SalesAuditReport.sources_note.
    raw_snippet: str | None = None


class DiscoveryProvider(Protocol):
    name: str

    def discover(self, criteria: DiscoveryCriteria) -> list[NormalizedBusinessResult]:
        """
        Runs one discovery query and returns normalized results (possibly
        empty — a real query that found nothing is not an error). Raises
        `ProviderUnavailableError` if the provider can't run at all.
        """
        ...
