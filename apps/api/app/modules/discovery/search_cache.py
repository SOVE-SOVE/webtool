"""
A 24h cache in front of `integrations/search.py::search_business`, built
for Instagram Search Discovery's `site:instagram.com` queries (see
integrations/discovery/instagram_search_provider.py) — "cache each
niche/suburb search for 24 hours" (docs/05_DECISIONS.md). Deliberately
lives in `modules/discovery/` (not `integrations/discovery/`, where the
provider that calls it lives) because it owns a real table
(DiscoverySearchCache) and every other ORM model in this app lives under
`modules/*/models.py`, registered via `app/db/all_models.py` — see that
model's own docstring for why the cache itself is not workspace-scoped.
`instagram_search_provider.py` importing from here is the one place an
`integrations/discovery/` module depends on `modules/discovery/`,
mirroring the CSV-import module's own precedent of putting Instagram-
specific plumbing wherever it naturally belongs rather than contorting
the provider/service boundary to avoid a single import.
"""

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.integrations import search as search_integration
from app.modules.discovery.models import DiscoverySearchCache

CACHE_TTL = timedelta(hours=24)


def _serialize(results: list[search_integration.SearchResult]) -> str:
    return json.dumps([result.__dict__ for result in results])


def _deserialize(raw: str) -> list[search_integration.SearchResult]:
    return [search_integration.SearchResult(**row) for row in json.loads(raw)]


def cached_search(
    db: Session | None, query: str, count: int, offset: int = 0
) -> tuple[list[search_integration.SearchResult] | None, bool]:
    """
    Returns `(results, cache_hit)`. `results` is `None` only when Brave
    itself is unavailable (unset key or a failed request) and there is
    no usable cache entry — mirrors `search_business`'s own "None means
    unavailable" contract, so a caller can raise `ProviderUnavailableError`
    exactly as it would for a direct call.

    Cached and looked up on the `(query, offset)` pair, not `query`
    alone — Brave's own `offset` param changes what a query actually
    returns (it's a different page of results), so a page-1 fetch must
    never be served page-0's cached response.

    `db=None` (e.g. a unit test constructing the provider directly, with
    no database in scope) skips caching entirely rather than raising —
    every call is a live Brave request in that case, same as before this
    cache existed.
    """
    if db is not None:
        cached = db.scalar(
            select(DiscoverySearchCache).where(
                DiscoverySearchCache.query_text == query, DiscoverySearchCache.brave_offset == offset
            )
        )
        if cached is not None and datetime.now(timezone.utc) - cached.fetched_at < CACHE_TTL:
            return _deserialize(cached.results_json), True

    results = search_integration.search_business(query, count=count, offset=offset)
    if results is None:
        return None, False

    if db is not None:
        row = db.scalar(
            select(DiscoverySearchCache).where(
                DiscoverySearchCache.query_text == query, DiscoverySearchCache.brave_offset == offset
            )
        )
        if row is None:
            row = DiscoverySearchCache(query_text=query, brave_offset=offset, results_json=_serialize(results))
            db.add(row)
        else:
            row.results_json = _serialize(results)
            row.fetched_at = datetime.now(timezone.utc)
        db.flush()

    return results, False
