"""
Classifies a plain-web-search result so Lead Discovery can keep actual
businesses and drop the generic web content a keyword search also
returns — forum threads, "top 10" listicles, news/blog articles,
encyclopaedia entries, and directory/aggregator listings.

Every result gets a `ResultCategory`:

- BUSINESS  — looks like one business's own page. Kept.
- SOCIAL    — a business's social-media profile. Kept as a candidate,
              but the URL is a social link, *not* an official website
              (the provider must not put it in `website_url`).
- DIRECTORY — an aggregator / listings page (many businesses, or a
              third-party listing rather than the business's own site).
              Dropped.
- ARTICLE   — a blog post, guide, listicle, wiki/reference page. Dropped.
- NEWS      — an editorial/news piece. Dropped.
- FORUM     — a forum thread / Q&A / discussion. Dropped.
- UNKNOWN   — nothing definitive either way. Kept (conservative — losing
              the odd junk result is cheaper than hiding a real
              business).

Deterministic and explainable (every classification carries a reason).
Website presence is never a signal here — a business with no website is
still a business. All inputs are already on `SearchResult` (see
integrations/search.py) — no extra network request.
"""

import enum
import re
from dataclasses import dataclass
from urllib.parse import urlparse


class ResultCategory(str, enum.Enum):
    BUSINESS = "business"
    SOCIAL = "social"
    DIRECTORY = "directory"
    ARTICLE = "article"
    NEWS = "news"
    FORUM = "forum"
    UNKNOWN = "unknown"


# Categories we keep as candidate businesses.
_KEEP = {ResultCategory.BUSINESS, ResultCategory.SOCIAL, ResultCategory.UNKNOWN}

# Registrable-domain suffixes, grouped by what a page there actually is.
# Matched against the host and every parent domain, so "old.reddit.com"
# and "au.reddit.com" both hit "reddit.com".
_FORUM_DOMAINS = frozenset(
    {"reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "whirlpool.net.au"}
)
_REVIEW_JOBS_DOMAINS = frozenset(
    {"productreview.com.au", "trustpilot.com", "glassdoor.com", "indeed.com", "seek.com.au", "gumtree.com.au"}
)
_REFERENCE_DOMAINS = frozenset({"wikipedia.org", "wikihow.com", "fandom.com", "britannica.com"})
_PUBLISHER_DOMAINS = frozenset(
    {"medium.com", "substack.com", "blogspot.com", "wordpress.com", "tumblr.com", "pinterest.com", "pinterest.com.au"}
)
_DIRECTORY_DOMAINS = frozenset(
    {
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
        "maps.google.com",
        "duckduckgo.com",
    }
)
_SOCIAL_DOMAINS = frozenset(
    {
        "facebook.com",
        "fb.com",
        "instagram.com",
        "linkedin.com",
        "twitter.com",
        "x.com",
        "tiktok.com",
        "youtube.com",
        "youtu.be",
    }
)
_NEWS_DOMAINS = frozenset(
    {
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

_DOMAIN_CATEGORIES: list[tuple[frozenset[str], ResultCategory]] = [
    (_FORUM_DOMAINS, ResultCategory.FORUM),
    (_REVIEW_JOBS_DOMAINS, ResultCategory.DIRECTORY),
    (_REFERENCE_DOMAINS, ResultCategory.ARTICLE),
    (_PUBLISHER_DOMAINS, ResultCategory.ARTICLE),
    (_DIRECTORY_DOMAINS, ResultCategory.DIRECTORY),
    (_SOCIAL_DOMAINS, ResultCategory.SOCIAL),
    (_NEWS_DOMAINS, ResultCategory.NEWS),
]

# Path fragments that mark an article / forum / tag index rather than a
# business's own page, even on an otherwise-unknown domain.
_ARTICLE_PATH_RE = re.compile(
    r"(^|/)(blog|blogs|news|article|articles|story|stories|wiki|tag|tags|tagged|"
    r"category|categories)(/|$|\.[a-z]+$)",
    re.IGNORECASE,
)
_FORUM_PATH_RE = re.compile(
    r"(^|/)(forum|forums|thread|threads|topic|topics|discussion|discussions|questions)(/|$|\.[a-z]+$)",
    re.IGNORECASE,
)
_SEARCH_PATH_RE = re.compile(r"(^|/)(search|find|results)(/|$|\.[a-z]+$)", re.IGNORECASE)

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

_SUBTYPE_CATEGORIES = {
    "faq": ResultCategory.ARTICLE,
    "qa": ResultCategory.ARTICLE,
    "news": ResultCategory.NEWS,
    "video": ResultCategory.ARTICLE,
    "discussion": ResultCategory.FORUM,
}


@dataclass(frozen=True)
class ResultClassification:
    category: ResultCategory
    reason: str

    @property
    def is_business(self) -> bool:
        """Backwards-compatible: a result we keep as a candidate business
        (BUSINESS, SOCIAL, or UNKNOWN)."""
        return self.category in _KEEP


def _registrable_candidates(host: str) -> list[str]:
    parts = host.split(".")
    return [".".join(parts[i:]) for i in range(len(parts))]


def _host_of(result) -> str:
    host = (getattr(result, "hostname", None) or "").lower()
    if not host and result.url:
        host = urlparse(result.url if "//" in result.url else f"//{result.url}").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def classify_result(result) -> ResultClassification:
    """`result` is an integrations.search.SearchResult (duck-typed here to
    avoid an import cycle)."""
    title = (result.title or "").strip()
    url = (result.url or "").strip()
    host = _host_of(result)

    if host:
        candidates = set(_registrable_candidates(host))
        for domains, category in _DOMAIN_CATEGORIES:
            hit = candidates & domains
            if hit:
                return ResultClassification(category, f"{category.value} site ({next(iter(hit))})")

    if getattr(result, "is_article", False):
        return ResultClassification(ResultCategory.ARTICLE, "search provider tagged this result as an article")

    subtype = getattr(result, "result_subtype", None)
    if subtype in _SUBTYPE_CATEGORIES:
        cat = _SUBTYPE_CATEGORIES[subtype]
        return ResultClassification(cat, f"result type '{subtype}'")

    path = urlparse(url).path if url else ""
    if path and path not in {"/", ""}:
        if _FORUM_PATH_RE.search(path):
            return ResultClassification(ResultCategory.FORUM, "URL path looks like a forum thread")
        if _ARTICLE_PATH_RE.search(path):
            return ResultClassification(ResultCategory.ARTICLE, "URL path looks like an article / tag index")
        if _SEARCH_PATH_RE.search(path):
            return ResultClassification(ResultCategory.DIRECTORY, "URL path looks like a search-results page")

    if title:
        for pattern in _LISTICLE_TITLE_RES:
            if pattern.search(title):
                return ResultClassification(
                    ResultCategory.ARTICLE, "headline reads as a listicle / guide / Q&A"
                )
        if _MULTI_BUSINESS_TITLE_RE.search(title):
            return ResultClassification(
                ResultCategory.DIRECTORY, "headline describes a page covering multiple businesses"
            )

    return ResultClassification(ResultCategory.BUSINESS, "no non-business signal")
