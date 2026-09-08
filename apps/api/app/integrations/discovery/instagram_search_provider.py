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

Pagination is two-dimensional, and both axes are bounded:

1. **Suburb** — `criteria.suburb_index` selects one of up to
   `base.py::MAX_SUBURBS_PER_SEARCH` operator-supplied suburbs.
2. **Page within that suburb** — `criteria.offset` is a real Brave
   `offset` (0, 1, 2…) for the *same* query, capped at
   `MAX_PAGES_PER_SUBURB` (3 by default: up to 60 raw Brave results
   examined per suburb per run, across 3 separate live/cached calls).

"Load more" exhausts a suburb's own pages first (deepening into that
suburb's Brave result set) before advancing to the next suburb — see
`InstagramSearchDiscoveryProvider.discover`'s next_offset/
next_suburb_index computation. This fixes the original bug where "load
more" jumped straight to the next suburb after a single Brave page-0
request, so a niche+suburb pairing that only surfaced one or two usable
profiles on page 0 had no way to find more of its own suburb's results.

If a suburb's very first (page-0) fetch returns too few valid profiles,
`_fetch_page_zero_with_fallback` tries a small, fixed set of broader
query-phrasing variations (dropping exact-phrase quoting on the niche,
then on the suburb) — never more than `MAX_QUERY_VARIATIONS_PER_SUBURB`
distinct queries, and every one actually fired counts toward
`DiscoveryPage.queries_used`/`cache_hits`, so the cost is fully visible
to the operator, never hidden. This never applies past page 0: a
"load more" deepening into an already-working suburb only ever uses the
strict, original query.

Each query variation/page is answered from — or added to — the 24h
search cache in `modules/discovery/search_cache.py` (keyed on the exact
query text *and* Brave offset) before falling through to a live Brave
call, so re-running (or "load more"-ing) the same niche+suburb+page
combination within the TTL window costs no extra quota.
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

# One Brave request per page — the same page size brave_search_provider
# uses, capped the same way by Brave itself.
_RESULTS_PER_QUERY = search_integration.BRAVE_MAX_COUNT

# Server-side cap: at most this many Brave result pages fetched per
# suburb per run (each page = one Brave request/cache entry, up to
# _RESULTS_PER_QUERY=20 raw results). A class attribute, not a module
# constant, so a test can shrink it without monkeypatching a global.
# Worst case per suburb: MAX_QUERY_VARIATIONS_PER_SUBURB page-0 attempts
# (fallback widening) + (MAX_PAGES_PER_SUBURB - 1) deeper strict-query
# pages — see the module docstring for the full worst-case accounting.
MAX_PAGES_PER_SUBURB = 3

# A page-0 fetch with fewer than this many valid, deduped candidates is
# considered "too sparse" and triggers fallback query widening — never
# past page 0 (see module docstring).
FALLBACK_MIN_VALID_RESULTS = 3

# Hard cap on distinct query strings tried for one suburb's page-0 fetch
# (the strict query plus fallbacks) — "small, controlled", never an
# unbounded widening search.
MAX_QUERY_VARIATIONS_PER_SUBURB = 3

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
    """The strict (most specific) query — both niche and suburb as exact
    phrases. Always variation [0] of `build_query_variations`."""
    return f'site:instagram.com "{_sanitize_phrase(niche)}" "{_sanitize_phrase(suburb)}"'


def build_query_variations(
    niche: str, suburb: str, max_variations: int = MAX_QUERY_VARIATIONS_PER_SUBURB
) -> list[str]:
    """
    Ordered strict-to-broad query variations for one suburb's page-0
    fetch — never more than `max_variations`. Widening
    drops exact-phrase quoting one field at a time (niche first, since a
    multi-word suburb name is more likely to need exact matching than a
    multi-word niche): quoting both is the most precise but most easily
    too-narrow-to-return-anything shape; unquoting progressively trades
    precision for recall. De-duplicated on exact string match as a
    defensive last resort (in the ordinary case all three render as
    distinct query strings) so a degenerate input can never waste a
    live call repeating an identical query.
    """
    niche = _sanitize_phrase(niche)
    suburb = _sanitize_phrase(suburb)
    candidates = [
        f'site:instagram.com "{niche}" "{suburb}"',
        f'site:instagram.com {niche} "{suburb}"',
        f'site:instagram.com "{niche}" {suburb}',
    ]
    seen: set[str] = set()
    variations: list[str] = []
    for q in candidates:
        if q not in seen:
            seen.add(q)
            variations.append(q)
    return variations[:max_variations]


_TRAILING_HANDLE_MENTION_RE = re.compile(r"\s*\(@[\w.]+\)\s*$")
# Brave's `profile.name` for an instagram.com result is the *site*
# name ("Instagram"), not the business's own name — unlike
# brave_search_provider.py, where profile_name genuinely is the brand
# name for an arbitrary site. Trusting it here silently gave every
# candidate the literal name "Instagram", which then collided every
# distinct business at the same suburb onto one dedup_key and dropped
# all but one from the review queue (found via a live QA run: 6 real,
# distinct nail salons all persisted with name "Instagram" before this
# fix, and modules/discovery/dedup.py's name+suburb key collapsed them
# to a single surviving row).
_GENERIC_NAMES = frozenset({"instagram"})


def _extract_name(title: str, profile_name: str | None, handle: str) -> str:
    if profile_name and profile_name.strip().lower() not in _GENERIC_NAMES:
        return profile_name.strip()[:255]
    first_segment = re.split(r"\s*[|•·]\s*|\s+-\s+|:\s+", (title or "").strip(), maxsplit=1)[0].strip()
    # A title like "Business Name (@handle) • Instagram photos and
    # videos" splits on "•" to "Business Name (@handle)" — the
    # parenthetical handle mention is noise, not part of the name.
    cleaned = _TRAILING_HANDLE_MENTION_RE.sub("", first_segment).strip()
    if cleaned and cleaned.lower() not in _GENERIC_NAMES:
        return cleaned[:255]
    return f"@{handle}"[:255]


def _build_candidate(result: search_integration.SearchResult, handle: str, niche: str, suburb: str) -> NormalizedBusinessResult:
    profile_url = f"https://instagram.com/{handle}"
    return NormalizedBusinessResult(
        name=_extract_name(result.title or "", result.profile_name, handle),
        website_url=None,
        website_status=WebsiteStatus.UNKNOWN,
        industry=niche,
        business_category=niche,
        suburb=suburb,
        social_links=[profile_url],
        source_external_id=profile_url,
        raw_snippet=result.description or None,
        # A hit under a suburb-scoped query is *approximate* location
        # evidence, not a confirmed address — never CONFIRMED, and never
        # geocoded to lat/lng (see LocationConfidence's own docstring).
        # This candidate will not appear on the map until a human
        # confirms a real location.
        location_confidence=LocationConfidence.APPROXIMATE,
        instagram_handle=handle,
        instagram_profile_url=profile_url,
        # Never inferred from a search result's absence of a website — a
        # search miss is not evidence of "no website" (see
        # InstagramWebsiteStatus's docstring). Only the manual "check for
        # website" action
        # (modules/discovery/service.py::check_instagram_website) can
        # move this off UNKNOWN_NEEDS_REVIEW.
        instagram_website_status=InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW,
    )


class InstagramSearchDiscoveryProvider:
    name = "instagram_search"
    # Class-attribute defaults (not module-level lookups inside the
    # methods below) so a test can override one on an instance without
    # monkeypatching a module global shared across parallel tests.
    max_pages_per_suburb = MAX_PAGES_PER_SUBURB
    fallback_min_valid_results = FALLBACK_MIN_VALID_RESULTS
    max_query_variations_per_suburb = MAX_QUERY_VARIATIONS_PER_SUBURB

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

        suburb_index = max(0, min(criteria.suburb_index, len(locations) - 1))
        suburb = locations[suburb_index]
        page_offset = max(0, min(criteria.offset, self.max_pages_per_suburb - 1))

        if page_offset == 0:
            candidates, queries_used, cache_hits, raw_checked, brave_has_more = self._fetch_page_zero_with_fallback(
                niche, suburb, db
            )
        else:
            candidates, queries_used, cache_hits, raw_checked, brave_has_more = self._fetch_deeper_page(
                niche, suburb, page_offset, db
            )

        suburb_has_more_pages = brave_has_more and page_offset + 1 < self.max_pages_per_suburb
        if suburb_has_more_pages:
            next_offset, next_suburb_index = page_offset + 1, suburb_index
        else:
            next_offset, next_suburb_index = 0, suburb_index + 1
        # `next_suburb_index` stays `suburb_index` (a valid, in-range
        # index) whenever this suburb has more pages of its own, so this
        # one check covers both axes: "there's a deeper page for the
        # current suburb" and "there's a next suburb to move to".
        has_more = next_suburb_index < len(locations)

        return DiscoveryPage(
            results=candidates[: criteria.limit],
            has_more=has_more,
            queries_used=queries_used,
            cache_hits=cache_hits,
            raw_results_checked=raw_checked,
            next_offset=next_offset,
            next_suburb_index=next_suburb_index,
        )

    def _fetch_deeper_page(
        self, niche: str, suburb: str, page_offset: int, db: "Session | None"
    ) -> tuple[list[NormalizedBusinessResult], int, int, int, bool]:
        """Page 1+ of a suburb already being paged through: the strict
        query only (no fallback widening — that only rescues an
        under-performing *first* attempt), at Brave's own `offset`."""
        query = build_query(niche, suburb)
        search_results, cache_hit = cached_search(db, query, count=_RESULTS_PER_QUERY, offset=page_offset)
        if search_results is None:
            raise ProviderUnavailableError(
                "Brave Search is unavailable — BRAVE_SEARCH_API_KEY may be unset, or the request failed"
            )
        candidates = self._extract_candidates(search_results, niche, suburb)
        brave_has_more = len(search_results) >= _RESULTS_PER_QUERY
        return (
            candidates,
            0 if cache_hit else 1,
            1 if cache_hit else 0,
            len(search_results),
            brave_has_more,
        )

    def _fetch_page_zero_with_fallback(
        self, niche: str, suburb: str, db: "Session | None"
    ) -> tuple[list[NormalizedBusinessResult], int, int, int, bool]:
        """
        The initial fetch for a suburb: the strict query, widened through
        up to `MAX_QUERY_VARIATIONS_PER_SUBURB` broader phrasings only if
        the strict one comes back too sparse (`FALLBACK_MIN_VALID_RESULTS`)
        — see `build_query_variations` and the module docstring. Every
        variation actually fired is counted in the returned queries_used/
        cache_hits/raw_results_checked, so this widening is never hidden
        from the operator-facing spend numbers.
        """
        variations = build_query_variations(niche, suburb, self.max_query_variations_per_suburb)
        seen_handles: set[str] = set()
        combined: list[NormalizedBusinessResult] = []
        queries_used = 0
        cache_hits = 0
        raw_checked = 0
        brave_has_more = False
        last_error: ProviderUnavailableError | None = None

        for query in variations:
            search_results, cache_hit = cached_search(db, query, count=_RESULTS_PER_QUERY, offset=0)
            if search_results is None:
                last_error = ProviderUnavailableError(
                    "Brave Search is unavailable — BRAVE_SEARCH_API_KEY may be unset, or the request failed"
                )
                # Brave being down mid-widening isn't a reason to discard
                # candidates a prior variation already found; only raise
                # if nothing has worked at all.
                continue

            queries_used += 0 if cache_hit else 1
            cache_hits += 1 if cache_hit else 0
            raw_checked += len(search_results)
            if query == variations[0]:
                brave_has_more = len(search_results) >= _RESULTS_PER_QUERY

            for result in search_results:
                handle = _extract_handle(result.url or "")
                if handle is None or handle in seen_handles:
                    continue
                classification = result_classifier.classify_result(result)
                if not classification.is_business:
                    continue
                seen_handles.add(handle)
                combined.append(_build_candidate(result, handle, niche, suburb))

            if len(combined) >= self.fallback_min_valid_results:
                break

        if not combined and last_error is not None:
            raise last_error

        return combined, queries_used, cache_hits, raw_checked, brave_has_more

    def _extract_candidates(
        self, search_results: list[search_integration.SearchResult], niche: str, suburb: str
    ) -> list[NormalizedBusinessResult]:
        seen_handles: set[str] = set()
        candidates: list[NormalizedBusinessResult] = []
        for result in search_results:
            handle = _extract_handle(result.url or "")
            if handle is None or handle in seen_handles:
                continue
            classification = result_classifier.classify_result(result)
            if not classification.is_business:
                continue
            seen_handles.add(handle)
            candidates.append(_build_candidate(result, handle, niche, suburb))
        return candidates
