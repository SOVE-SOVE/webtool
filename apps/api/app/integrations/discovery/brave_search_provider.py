"""
Business discovery via Brave Search — the one real provider adapter
built so far. Reuses `integrations/search.py` (already used by the
Sales Audit feature), so it needs no new dependency or credential: it
degrades the same way that feature already does when
`BRAVE_SEARCH_API_KEY` is unset, except here that's surfaced as
`ProviderUnavailableError` rather than a silently-skipped section, since
a discovery search with no provider able to run is the whole request
failing, not one section of a larger report.

A general web search is not a purpose-built business directory/places
API — it does not return structured phone/address/industry fields, only
title/url/description per result. Those are left unset on the
normalized result rather than guessed (see NormalizedBusinessResult's
docstring); a future provider (Google Places, ABN Lookup, a directory
scrape — see docs/02_ARCHITECTURE.md "To be decided") can fill them in
without any change to modules/discovery/service.py.
"""

import re

from app.integrations import search as search_integration
from app.integrations.discovery.base import DiscoveryCriteria, NormalizedBusinessResult, ProviderUnavailableError

_TITLE_SPLIT_RE = re.compile(r"\s+[|–—-]\s+|:\s+")
MAX_NAME_LENGTH = 255


def _extract_name(title: str) -> str:
    """
    Search-result titles are often "Business Name | Site Section",
    "Business Name - tagline", or "Business Name: tagline" — take the
    first segment, since that's consistently the business name in
    practice (found via a live test run: "Gold Coast Plumbing Company:
    Your Trusted Gold Coast Plumber" wasn't being split on the colon),
    and truncate to the column's max length rather than guessing at a
    cleaner name.
    """
    first_segment = _TITLE_SPLIT_RE.split(title.strip(), maxsplit=1)[0].strip()
    name = first_segment or title.strip()
    return name[:MAX_NAME_LENGTH]


def _build_query(criteria: DiscoveryCriteria) -> str:
    parts = [criteria.industry, criteria.business_type, criteria.keywords, criteria.location]
    return " ".join(p for p in parts if p)


class BraveSearchDiscoveryProvider:
    name = "brave_search"

    def discover(self, criteria: DiscoveryCriteria) -> list[NormalizedBusinessResult]:
        query = _build_query(criteria)
        results = search_integration.search_business(query)
        if results is None:
            raise ProviderUnavailableError(
                "Brave Search is unavailable — BRAVE_SEARCH_API_KEY may be unset, or the request failed"
            )

        normalized: list[NormalizedBusinessResult] = []
        for result in results[: criteria.limit]:
            if not result.title or not result.url:
                continue
            normalized.append(
                NormalizedBusinessResult(
                    name=_extract_name(result.title),
                    website_url=result.url,
                    industry=criteria.industry,
                    source_external_id=result.url,
                    raw_snippet=result.description or None,
                )
            )
        return normalized
