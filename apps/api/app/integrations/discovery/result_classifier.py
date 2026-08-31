"""
Tells a real business page apart from the generic web pages a plain web
search also returns — forum threads, "top 10" listicles, news/blog
articles, encyclopaedia entries, and directory/aggregator listings that
represent many businesses rather than one.

Deterministic and explainable (a rejected result always carries a
reason), and deliberately conservative: an ambiguous result is kept, not
dropped. Losing the occasional junk result is cheaper than silently
hiding a real business the operator would have wanted to see. Website
presence is never a factor here — a business with no website is still a
business (see modules/discovery/service.py's has_website handling).

Signals used are all already on `SearchResult` (see
integrations/search.py) — no extra network request.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlparse

# Registrable-domain suffixes whose pages are, essentially always, either
# about businesses rather than a business, or user-generated content —
# never the operator's prospect. Matched against the result host and any
# parent domain (so "old.reddit.com" and "au.reddit.com" both hit
# "reddit.com").
_NON_BUSINESS_DOMAINS = frozenset(
    {
        # forums / Q&A / user-generated
        "reddit.com",
        "quora.com",
        "stackexchange.com",
        "stackoverflow.com",
        "whirlpool.net.au",
        "productreview.com.au",
        "trustpilot.com",
        "glassdoor.com",
        "indeed.com",
        "seek.com.au",
        "gumtree.com.au",
        # encyclopaedia / reference
        "wikipedia.org",
        "wikihow.com",
        "fandom.com",
        "britannica.com",
        # blogging / publishing platforms
        "medium.com",
        "substack.com",
        "blogspot.com",
        "wordpress.com",
        "tumblr.com",
        "pinterest.com",
        "pinterest.com.au",
        # directories / aggregators (a page here lists many businesses)
        "yelp.com",
        "yelp.com.au",
        "yellowpages.com.au",
        "yellowpages.com",
        "whitepages.com.au",
        "truelocal.com.au",
        "localsearch.com.au",
        "hotfrog.com.au",
        "hotfrog.com",
        "startlocal.com.au",
        "aussieweb.com.au",
        "womo.com.au",
        "oneflare.com.au",
        "hipages.com.au",
        "serviceseeking.com.au",
        "airtasker.com",
        "tripadvisor.com",
        "tripadvisor.com.au",
        "zomato.com",
        "opentable.com.au",
        "opentable.com",
        "booking.com",
        "expedia.com",
        "expedia.com.au",
        "agoda.com",
        "trivago.com",
        "google.com",
        "bing.com",
        "facebook.com",
        "instagram.com",
        "linkedin.com",
        "twitter.com",
        "x.com",
        "tiktok.com",
        "youtube.com",
        "maps.google.com",
        # news / editorial
        "news.com.au",
        "abc.net.au",
        "smh.com.au",
        "theage.com.au",
        "theguardian.com",
        "nytimes.com",
        "bbc.com",
        "bbc.co.uk",
        "9news.com.au",
        "7news.com.au",
        "6news.com.au",
        "dailymail.co.uk",
        "forbes.com",
        "businessinsider.com",
        "timeout.com",
        "broadsheet.com.au",
        "theurbanlist.com",
        "urbanlist.com",
        "concreteplayground.com",
        "delicious.com.au",
        "goodfood.com.au",
        "lonelyplanet.com",
        "tripsavvy.com",
        "nationalgeographic.com",
    }
)

# Path fragments that mark an article / forum / tag index rather than a
# business's own page, even on an otherwise-unknown domain.
_NON_BUSINESS_PATH_RE = re.compile(
    r"(^|/)(blog|blogs|news|article|articles|story|stories|wiki|forum|forums|"
    r"thread|threads|topic|topics|discussion|questions|tag|tags|tagged|"
    r"category|categories|search|find)(/|$|\.[a-z]+$)",
    re.IGNORECASE,
)

# Listicle / guide / how-to headline shapes. Kept tight so a real name
# that merely starts with a number ("4 Pines Brewing", "7-Eleven") is
# not caught.
_LISTICLE_TITLE_RES = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^\s*(the\s+)?(top\s+)?\d{1,3}\s+(best|top|great|greatest|amazing|must[- ]|coolest|"
        r"cheapest|finest|favourite|favorite|essential|iconic|hidden|underrated|popular)\b",
        r"\b(top|best|worst)\s+\d{1,3}\b",
        r"\b\d{1,3}\s+(of\s+the\s+)?(best|top|greatest|must[- ])\b",
        r":\s*(a|the|your)\s+(complete\s+|ultimate\s+|beginner'?s\s+|quick\s+)?guide\b",
        r"\b(ultimate|complete|comprehensive|definitive)\s+guide\b",
        r"^\s*how\s+to\b",
        r"^\s*(what|why|when|where|which|who)\s+(is|are|to|do|does|should|can)\b",
        r"\bthings\s+to\s+do\b",
        r"\bwhere\s+to\s+(eat|stay|drink|shop|go|find)\b",
        r"\b(reddit|forum\s+thread)\b",
        r"\breview(ed|s)?\s*:\s",
        r"\bpros\s+and\s+cons\b",
    )
)

# Words that, in a title, signal a page covering many businesses.
_MULTI_BUSINESS_TITLE_RE = re.compile(
    r"\b(directory|listings?|near\s+you|nearby|in\s+your\s+area|"
    r"compare\s+\d|find\s+a\s+\w+\s+(near|in)\b)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ResultClassification:
    is_business: bool
    reason: str


def _registrable_candidates(host: str) -> list[str]:
    """['a.b.example.com'] -> ['a.b.example.com', 'b.example.com',
    'example.com', 'com'] so a suffix match against the denylist works
    regardless of subdomain."""
    parts = host.split(".")
    return [".".join(parts[i:]) for i in range(len(parts))]


def classify_result(result) -> ResultClassification:
    """`result` is an integrations.search.SearchResult (duck-typed here to
    avoid an import cycle)."""
    title = (result.title or "").strip()
    url = (result.url or "").strip()

    host = (result.hostname or "").lower()
    if not host and url:
        host = urlparse(url if "//" in url else f"//{url}").netloc.lower()
    if host.startswith("www."):
        host = host[4:]

    if host:
        for candidate in _registrable_candidates(host):
            if candidate in _NON_BUSINESS_DOMAINS:
                return ResultClassification(False, f"non-business site ({candidate})")

    if getattr(result, "is_article", False):
        return ResultClassification(False, "search provider tagged this result as an article")

    if getattr(result, "result_subtype", None) in {"faq", "qa", "news", "video", "discussion"}:
        return ResultClassification(False, f"result type '{result.result_subtype}' is not a business page")

    path = urlparse(url).path if url else ""
    if path and path not in {"/", ""} and _NON_BUSINESS_PATH_RE.search(path):
        return ResultClassification(False, "URL path looks like an article/forum/index page")

    if title:
        for pattern in _LISTICLE_TITLE_RES:
            if pattern.search(title):
                return ResultClassification(False, "headline reads as a listicle / guide / Q&A, not a business")
        if _MULTI_BUSINESS_TITLE_RE.search(title):
            return ResultClassification(False, "headline describes a page covering multiple businesses")

    return ResultClassification(True, "no non-business signal")
