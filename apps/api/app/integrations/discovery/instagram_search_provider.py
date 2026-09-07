"""
Instagram Search Discovery (Phase 2 of Instagram Discovery —
docs/05_DECISIONS.md) — finds publicly-indexed Instagram business
profiles via the existing Brave web-search wrapper
(`integrations/search.py`), using `site:instagram.com "<niche>"
"<suburb>"` queries. Not a Meta API integration and not a scrape of
instagram.com: every result comes back from Brave's own search index,
the exact same mechanism `brave_search_provider.py` already uses for a
plain business search (which already classifies instagram.com as a
SOCIAL domain — see `result_classifier.py` — and already keeps a social
hit as a candidate rather than discarding it). Phase 1's
`modules/discovery/instagram_import.py` (manual CSV import) is
unrelated and unchanged; see its module docstring and
docs/05_DECISIONS.md for why Meta's own Business Discovery API can't do
what this module does (no location/category search) and why scraping
instagram.com was rejected — neither constraint applies here, since this
never talks to Instagram at all.

One `discover()` call = one suburb's query. `criteria.offset` indexes
into `criteria.locations` (not a deep-pagination offset within one
suburb — a restrained, capped set of searches is the point), so "load
more" naturally means "run the next unfetched suburb", reusing
`modules/discovery/service.py`'s existing has_more/next_offset page
bookkeeping unchanged. The suburb count itself is capped at
`base.py::MAX_SUBURBS_PER_SEARCH`, enforced both by the service layer's
request validation and (defensively) here.

Each suburb's query is answered from — or added to — the 24h search
cache in `modules/discovery/search_cache.py` before falling through to a
live Brave call, so re-running (or "load more"-ing) the same niche+
suburb combination within the TTL window costs no extra quota.
"""

import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from app.integrations import search as search_integration
from app.integrations.discovery import result_classifier
from app.integrations.discovery.base import (
    MAX_SUBURBS_PER_SEARCH,
    DiscoveryCriteria,
    DiscoveryPage,
    InstagramWebsiteStatus,
    LocationConfidence,
    NormalizedBusinessResult,
    ProviderUnavailableError,
    WebsiteStatus,
)
from app.integrations.discovery.result_classifier import ResultCategory
from app.modules.discovery.search_cache import cached_search

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

# One Brave request per suburb — the same page size brave_search_provider
# uses, capped the same way by Brave itself.
_RESULTS_PER_QUERY = search_integration.BRAVE_MAX_COUNT

# Path segments on instagram.com that are never a business's own profile
# — reels/stories/tags/explore/etc. — even though the host matches.
# Checked *in addition to* "exactly one path segment" below (a real
# profile URL is always host + one segment, nothing more), so a
# multi-segment URL under one of these (e.g. /p/Cxyz123/) is rejected on
# shape alone before this set is even consulted.
_NON_PROFILE_SEGMENTS = frozenset(
    {
        "p",
        "reel",
        "reels",
        "stories",
        "story",
        "explore",
        "accounts",
        "tv",
        "direct",
        "about",
        "legal",
        "developer",
        "web",
        "challenge",
        "nametag",
        "audio",
        "locations",
        "topics",
        "session",
        "graphql",
        "ajax",
        "embed",
        "api",
        "oauth",
        "privacy",
        "terms",
        "help",
        "download",
        "lite",
    }
)
# A real handle is letters/digits/underscore/period, 1-30 chars (Instagram's
# own limit) — anything else (query strings smuggled into the path, a
# stray unicode segment) is rejected rather than guessed at.
_HANDLE_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")

_QUOTE_RE = re.compile(r'["“”]')


def _extract_handle(url: str) -> str | None:
    """
    Returns the normalized (lowercased) Instagram handle for a real
    profile URL, or `None` for anything else — a reel/story/tag/hashtag/
    explore/audio/directory page, a URL with extra path segments, a
    query-only path, or a non-Instagram host. Deliberately strict: a
    false negative here only costs one candidate; a false positive would
    create a junk lead that flows all the way to the review queue.
    """
    try:
        parsed = urlparse(url if "//" in url else f"//{url}")
    except ValueError:
        return None
    host = (parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in {"instagram.com", "instagr.am"}:
        return None

    segments = [s for s in parsed.path.split("/") if s]
    if len(segments) != 1:
        return None
    handle = segments[0].lower()
    if handle in _NON_PROFILE_SEGMENTS or handle.startswith("tags"):
        return None
    if not _HANDLE_RE.match(handle):
        return None
    return handle


def _sanitize_phrase(text: str) -> str:
    """Strips characters that would break out of the `"..."` quoting in a
    generated query — an operator-entered niche/suburb is free text, not
    something we control the shape of."""
    return _QUOTE_RE.sub("", text).strip()


def _niche_phrase(criteria: DiscoveryCriteria) -> str:
    parts = [criteria.business_type, criteria.industry, criteria.keywords]
    return " ".join(_sanitize_phrase(p) for p in parts if p and p.strip())


def build_query(niche: str, suburb: str) -> str:
    return f'site:instagram.com "{_sanitize_phrase(niche)}" "{_sanitize_phrase(suburb)}"'


def _extract_name(title: str, profile_name: str | None, handle: str) -> str:
    if profile_name and profile_name.strip():
        return profile_name.strip()[:255]
    cleaned = re.split(r"\s*[|•·]\s*|\s+-\s+|:\s+", (title or "").strip(), maxsplit=1)[0].strip()
    return (cleaned or f"@{handle}")[:255]


class InstagramSearchDiscoveryProvider:
    name = "instagram_search"

    def discover(self, criteria: DiscoveryCriteria, db: "Session | None" = None) -> DiscoveryPage:
        locations = [loc.strip() for loc in (criteria.locations or []) if loc and loc.strip()]
        locations = locations[:MAX_SUBURBS_PER_SEARCH]
        if not locations:
            raise ProviderUnavailableError("instagram_search requires at least one suburb/city")

        niche = _niche_phrase(criteria)
        if not niche:
            raise ProviderUnavailableError(
                "instagram_search requires a niche (industry, business type, or keywords)"
            )

        suburb_index = max(0, min(criteria.offset, len(locations) - 1))
        suburb = locations[suburb_index]
        query = build_query(niche, suburb)

        search_results, cache_hit = cached_search(db, query, count=_RESULTS_PER_QUERY)
        if search_results is None:
            raise ProviderUnavailableError(
                "Brave Search is unavailable — BRAVE_SEARCH_API_KEY may be unset, or the request failed"
            )

        seen_handles: set[str] = set()
        normalized: list[NormalizedBusinessResult] = []
        for result in search_results:
            if not result.url:
                continue
            handle = _extract_handle(result.url)
            if handle is None or handle in seen_handles:
                continue
            # Reuses the existing result classifier (an instagram.com URL
            # always resolves to SOCIAL there — see its _SOCIAL_DOMAINS —
            # kept here as the same defense-in-depth every other provider
            # applies, and so a future classifier change is respected
            # rather than bypassed).
            classification = result_classifier.classify_result(result)
            if not classification.is_business:
                continue
            seen_handles.add(handle)

            profile_url = f"https://instagram.com/{handle}"
            normalized.append(
                NormalizedBusinessResult(
                    name=_extract_name(result.title or "", result.profile_name, handle),
                    website_url=None,
                    website_status=WebsiteStatus.UNKNOWN,
                    industry=niche,
                    business_category=niche,
                    suburb=suburb,
                    social_links=[profile_url],
                    source_external_id=profile_url,
                    raw_snippet=result.description or None,
                    # A hit under a suburb-scoped query is *approximate*
                    # location evidence, not a confirmed address — never
                    # CONFIRMED, and never geocoded to lat/lng (see
                    # LocationConfidence's own docstring). This candidate
                    # will not appear on the map until a human confirms
                    # a real location.
                    location_confidence=LocationConfidence.APPROXIMATE,
                    instagram_handle=handle,
                    instagram_profile_url=profile_url,
                    # Never inferred from a search result's absence of a
                    # website — a search miss is not evidence of "no
                    # website" (see InstagramWebsiteStatus's docstring).
                    # Only the manual "check for website" action
                    # (modules/discovery/service.py::check_instagram_website)
                    # can move this off UNKNOWN_NEEDS_REVIEW.
                    instagram_website_status=InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW,
                )
            )

        has_more = suburb_index + 1 < len(locations)
        return DiscoveryPage(
            results=normalized[: criteria.limit],
            has_more=has_more,
            queries_used=0 if cache_hit else 1,
            cache_hits=1 if cache_hit else 0,
        )
