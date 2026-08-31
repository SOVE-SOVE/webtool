"""
The result classifier that keeps Lead Discovery returning actual
businesses rather than the forum threads / listicles / news pieces /
directory pages a plain web search also surfaces (T1). Conservative by
design: anything it can't confidently rule out is kept.
"""

import pytest

from app.integrations.discovery.result_classifier import classify_result
from app.integrations.search import SearchResult


def _r(title="Some Local Business", url="https://somelocalbusiness.com.au/", **kw):
    return SearchResult(title=title, url=url, description=kw.pop("description", ""), **kw)


# --- kept: real businesses --------------------------------------------------


@pytest.mark.parametrize(
    "result",
    [
        _r("Gold Coast Plumbing Co | Home", url="https://gcplumbing.com.au/"),
        _r("Southport Plumbers - Fast 24/7 Service", url="https://southportplumbers.com.au/services"),
        _r("4 Pines Brewing Company", url="https://4pinesbeer.com.au/"),
        _r("7-Eleven Southport", url="https://7eleven.com.au/stores/southport"),
        _r("Bean There Cafe", url="https://beantherecafe.com.au/", profile_name="Bean There Cafe"),
        # no website-style host, still a business page
        _r("Nimbin Bakery", url="https://nimbinbakery.au/about"),
    ],
)
def test_keeps_real_business_pages(result):
    assert classify_result(result).is_business is True


def test_ambiguous_result_is_kept():
    # Unknown domain, neutral title, no article flag — keep it.
    assert classify_result(_r("Riverside Dental", url="https://riverside-dental.example/")).is_business


# --- dropped: non-business pages ------------------------------------------


@pytest.mark.parametrize(
    "result,needle",
    [
        (_r("Best plumber on the Gold Coast?", url="https://www.reddit.com/r/goldcoast/comments/x"), "reddit.com"),
        (_r("Old thread", url="https://old.reddit.com/r/brisbane/abc"), "reddit.com"),
        (_r("Plumbing - Wikipedia", url="https://en.wikipedia.org/wiki/Plumbing"), "wikipedia.org"),
        (_r("Gold Coast plumbers", url="https://www.yellowpages.com.au/search/listings"), "yellowpages.com.au"),
        (_r("Sydney cafes", url="https://www.tripadvisor.com.au/Restaurants-g255060"), "tripadvisor"),
        (_r("A cafe review", url="https://someblog.medium.com/a-cafe-review-123"), "medium.com"),
        (_r("News piece", url="https://www.abc.net.au/news/2024-01-01/story"), "abc.net.au"),
    ],
)
def test_drops_non_business_domains(result, needle):
    verdict = classify_result(result)
    assert verdict.is_business is False
    assert needle in verdict.reason


@pytest.mark.parametrize(
    "title",
    [
        "The 10 Best Cafes in Brisbane (2024)",
        "15 Amazing Plumbers You Need to Know",
        "Top 5 Gold Coast Restaurants",
        "Ultimate Guide to Hiring a Plumber",
        "How to Choose a Good Electrician",
        "Where to Eat on the Gold Coast",
        "Things to do in Byron Bay",
        "Best 20 hair salons near you",
    ],
)
def test_drops_listicle_and_guide_headlines(title):
    assert classify_result(_r(title, url="https://randomsite.example/x")).is_business is False


def test_drops_results_flagged_as_articles_by_provider():
    result = _r("Local plumber profiled", url="https://trade-magazine.example/piece", is_article=True)
    assert classify_result(result).is_business is False


def test_drops_article_and_blog_url_paths():
    assert not classify_result(_r("Plumbing tips", url="https://trades.example/blog/plumbing-tips")).is_business
    assert not classify_result(_r("Forum", url="https://trades.example/forum/thread/99")).is_business


def test_drops_multi_business_directory_headlines():
    assert not classify_result(_r("Plumber Directory - Gold Coast Listings", url="https://x.example/")).is_business
