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

What a general web search *does* return alongside real businesses is a
lot of noise — forum threads, "top 10" listicles, news pieces, wiki
entries, directory pages. `result_classifier` drops those before they
become candidate businesses (see its docstring for the signals used);
everything it can't confidently rule out is kept.
"""

import re

from app.integrations import search as search_integration
from app.integrations.discovery import result_classifier
from app.integrations.discovery.base import DiscoveryCriteria, NormalizedBusinessResult, ProviderUnavailableError

_TITLE_SPLIT_RE = re.compile(r"\s+[|–—-]\s+|:\s+")
MAX_NAME_LENGTH = 255
# Ask Brave for a full page of results (its per-request max) rather than
# a handful — after the classifier drops non-business pages, a small raw
# set leaves too few real businesses. Pagination beyond one page is a
# separate concern (see criteria.limit / the discovery service).
_FETCH_COUNT = 20


def _extract_name(title: str, profile_name: str | None = None) -> str:
    """
    Prefer the search provider's own site/brand name when it gives one
    (`profile.name` — already the clean business name). Otherwise fall
    back to the result title: these are often "Business Name | Site
    Section", "Business Name - tagline", or "Business Name: tagline" —
    take the first segment, since that's consistently the business name
    in practice (found via a live test run: "Gold Coast Plumbing
    Company: Your Trusted Gold Coast Plumber" wasn't being split on the
    colon), and truncate to the column's max length rather than guessing
    at a cleaner name.
    """
    if profile_name and profile_name.strip():
        return profile_name.strip()[:MAX_NAME_LENGTH]
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
        results = search_integration.search_business(query, count=_FETCH_COUNT)
        if results is None:
            raise ProviderUnavailableError(
                "Brave Search is unavailable — BRAVE_SEARCH_API_KEY may be unset, or the request failed"
            )

        normalized: list[NormalizedBusinessResult] = []
        for result in results:
            if not result.title or not result.url:
                continue
            if not result_classifier.classify_result(result).is_business:
                continue
            normalized.append(
                NormalizedBusinessResult(
                    name=_extract_name(result.title, result.profile_name),
                    website_url=result.url,
                    industry=criteria.industry,
                    source_external_id=result.url,
                    raw_snippet=result.description or None,
                )
            )
            if len(normalized) >= criteria.limit:
                break
        return normalized
