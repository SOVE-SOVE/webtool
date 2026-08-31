"""
Brave Search wrapper — used by agents/sales_audit.py to see what's
publicly visible about a business beyond its own website, and by
integrations/discovery/brave_search_provider.py to find candidate
businesses. Degrades gracefully (returns None) rather than raising when
unconfigured or unreachable, so a missing/expired API key never breaks
report generation — it just means that evidence isn't available this
time.
"""

from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.core.logging import logger
from app.core.settings import settings

SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
# Default page size. Brave's web search API caps `count` at 20 per
# request; callers that want more (discovery) ask for it explicitly.
RESULT_LIMIT = 5
BRAVE_MAX_COUNT = 20
REQUEST_TIMEOUT_S = 10.0


@dataclass
class SearchResult:
    title: str
    url: str
    description: str
    # Extra signals Brave already returns per result — captured so the
    # discovery result classifier can tell a real business page from an
    # article/forum/directory listing without a second request. All
    # optional; callers that predate these (sales audit) ignore them.
    hostname: str | None = None
    profile_name: str | None = None
    page_age: str | None = None
    is_article: bool = False
    result_subtype: str | None = None


def _host_from_url(url: str) -> str | None:
    try:
        netloc = urlparse(url).netloc.lower()
    except ValueError:
        return None
    return netloc[4:] if netloc.startswith("www.") else netloc or None


def _parse_result(raw: dict) -> SearchResult:
    meta_url = raw.get("meta_url") or {}
    profile = raw.get("profile") or {}
    hostname = (meta_url.get("hostname") or "").lower() or _host_from_url(raw.get("url", ""))
    if hostname and hostname.startswith("www."):
        hostname = hostname[4:]
    return SearchResult(
        title=raw.get("title", ""),
        url=raw.get("url", ""),
        description=raw.get("description", ""),
        hostname=hostname or None,
        profile_name=profile.get("name") or profile.get("long_name") or None,
        page_age=raw.get("page_age") or raw.get("age") or None,
        # Brave marks editorial results with an `article` object and/or a
        # "article" subtype — a strong "this is a news/blog piece, not a
        # business" signal.
        is_article=bool(raw.get("article")) or raw.get("subtype") == "article",
        result_subtype=raw.get("subtype") or None,
    )


def search_business(query: str, count: int = RESULT_LIMIT) -> list[SearchResult] | None:
    if not settings.brave_search_api_key:
        return None

    count = max(1, min(count, BRAVE_MAX_COUNT))
    try:
        response = httpx.get(
            SEARCH_URL,
            params={"q": query, "count": count},
            headers={
                "Accept": "application/json",
                "X-Subscription-Token": settings.brave_search_api_key,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        response.raise_for_status()
        results = response.json().get("web", {}).get("results", [])
        return [_parse_result(r) for r in results[:count]]
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.warning("Brave Search request failed for query %r: %s", query, exc)
        return None
