"""
Brave Search wrapper — used by agents/sales_audit.py to see what's
publicly visible about a business beyond its own website. Degrades
gracefully (returns None) rather than raising when unconfigured or
unreachable, so a missing/expired API key never breaks report
generation — it just means that evidence isn't available this time.
"""

from dataclasses import dataclass

import httpx

from app.core.logging import logger
from app.core.settings import settings

SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
RESULT_LIMIT = 5
REQUEST_TIMEOUT_S = 10.0


@dataclass
class SearchResult:
    title: str
    url: str
    description: str


def search_business(query: str) -> list[SearchResult] | None:
    if not settings.brave_search_api_key:
        return None

    try:
        response = httpx.get(
            SEARCH_URL,
            params={"q": query, "count": RESULT_LIMIT},
            headers={
                "Accept": "application/json",
                "X-Subscription-Token": settings.brave_search_api_key,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        response.raise_for_status()
        results = response.json().get("web", {}).get("results", [])
        return [
            SearchResult(
                title=r.get("title", ""),
                url=r.get("url", ""),
                description=r.get("description", ""),
            )
            for r in results[:RESULT_LIMIT]
        ]
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("Brave Search request failed for query %r: %s", query, exc)
        return None
