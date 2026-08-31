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
from app.integrations.discovery.result_classifier import ResultCategory
from app.integrations.discovery.base import (
    DiscoveryCriteria,
    DiscoveryPage,
    NormalizedBusinessResult,
    ProviderUnavailableError,
    WebsiteStatus,
)

_TITLE_SPLIT_RE = re.compile(r"\s+[|–—-]\s+|:\s+")
MAX_NAME_LENGTH = 255
# Brave returns at most 20 web results per request and pages 0..9 deep.
# One discovery page = one Brave request; "load more" advances the
# offset. After the classifier drops non-business pages a request of 20
# still leaves a usable page of real businesses.
_PAGE_SIZE = search_integration.BRAVE_MAX_COUNT
_MAX_OFFSET = search_integration.BRAVE_MAX_OFFSET


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

    def discover(self, criteria: DiscoveryCriteria) -> DiscoveryPage:
        query = _build_query(criteria)
        offset = max(0, min(criteria.offset, _MAX_OFFSET))
        count = max(1, min(criteria.limit, _PAGE_SIZE))
        results = search_integration.search_business(query, count=count, offset=offset)
        if results is None:
            raise ProviderUnavailableError(
                "Brave Search is unavailable — BRAVE_SEARCH_API_KEY may be unset, or the request failed"
            )

        normalized: list[NormalizedBusinessResult] = []
        for result in results:
            if not result.title or not result.url:
                continue
            classification = result_classifier.classify_result(result)
            if not classification.is_business:
                continue

            if classification.category is ResultCategory.SOCIAL:
                # A social-media profile can be a real business's only web
                # presence — keep it as a candidate, but its URL is a
                # social link, never the "official website".
                normalized.append(
                    NormalizedBusinessResult(
                        name=_extract_name(result.title, result.profile_name),
                        website_url=None,
                        website_status=WebsiteStatus.UNKNOWN,
                        industry=criteria.industry,
                        social_links=[result.url],
                        source_external_id=result.url,
                        raw_snippet=result.description or None,
                    )
                )
                continue

            normalized.append(
                NormalizedBusinessResult(
                    name=_extract_name(result.title, result.profile_name),
                    website_url=result.url,
                    # A web-search hit on the business's own domain is a
                    # real website.
                    website_status=WebsiteStatus.FOUND,
                    industry=criteria.industry,
                    source_external_id=result.url,
                    raw_snippet=result.description or None,
                )
            )

        # Worth asking for another page only if this one came back full
        # (a short page means Brave ran out of results) and we haven't
        # hit Brave's offset ceiling.
        has_more = offset < _MAX_OFFSET and len(results) >= count
        return DiscoveryPage(results=normalized[: criteria.limit], has_more=has_more)
