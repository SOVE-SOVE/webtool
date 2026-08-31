"""
The result classifier that keeps Lead Discovery returning actual
businesses rather than the forum threads / listicles / news pieces /
directory pages a plain web search also surfaces (T1 + T9). Every
result gets a ResultCategory; conservative by design — anything it
can't confidently rule out is kept as BUSINESS.
"""

import pytest

from app.integrations.discovery.result_classifier import ResultCategory, classify_result
from app.integrations.search import SearchResult


def _r(title="Some Local Business", url="https://somelocalbusiness.com.au/", **kw):
    return SearchResult(title=title, url=url, description=kw.pop("description", ""), **kw)


def _cat(result) -> ResultCategory:
    return classify_result(result).category


# --- kept: real businesses --------------------------------------------------


@pytest.mark.parametrize(
    "result",
    [
        _r("Gold Coast Plumbing Co | Home", url="https://gcplumbing.com.au/"),
        _r("Southport Plumbers - Fast 24/7 Service", url="https://southportplumbers.com.au/services"),
        _r("4 Pines Brewing Company", url="https://4pinesbeer.com.au/"),
        _r("7-Eleven Southport", url="https://7eleven.com.au/stores/southport"),
        _r("Bean There Cafe", url="https://beantherecafe.com.au/", profile_name="Bean There Cafe"),
        _r("Nimbin Bakery", url="https://nimbinbakery.au/about"),
    ],
)
def test_keeps_real_business_pages(result):
    verdict = classify_result(result)
    assert verdict.is_business is True
    assert verdict.category is ResultCategory.BUSINESS


def test_business_with_limited_information_is_still_a_business():
    # Bare title, unknown domain, no description — still kept.
    assert _cat(_r("Joe's Panelbeating", url="https://joespanel.example/", description="")) is ResultCategory.BUSINESS


def test_ambiguous_result_is_kept_as_business():
    assert classify_result(_r("Riverside Dental", url="https://riverside-dental.example/")).is_business


# --- social profiles: kept as a candidate, not an official website -------


@pytest.mark.parametrize(
    "url",
    [
        "https://www.facebook.com/NimbinBakeryCafe",
        "https://instagram.com/nimbinbakery",
        "https://www.linkedin.com/company/nimbin-bakery",
    ],
)
def test_social_profiles_classified_social_and_kept(url):
    verdict = classify_result(_r("Nimbin Bakery", url=url))
    assert verdict.category is ResultCategory.SOCIAL
    assert verdict.is_business is True  # kept — a real business may only have a FB page


# --- dropped: not one business -----------------------------------------------


@pytest.mark.parametrize(
    "result,category,needle",
    [
        (_r("Best plumber?", url="https://www.reddit.com/r/goldcoast/comments/x"), ResultCategory.FORUM, "reddit.com"),
        (_r("Old thread", url="https://old.reddit.com/r/brisbane/abc"), ResultCategory.FORUM, "reddit.com"),
        (_r("Plumbing - Wikipedia", url="https://en.wikipedia.org/wiki/Plumbing"), ResultCategory.ARTICLE, "wikipedia.org"),
        (_r("Gold Coast plumbers", url="https://www.yellowpages.com.au/search/listings"), ResultCategory.DIRECTORY, "yellowpages.com.au"),
        (_r("Sydney cafes", url="https://www.tripadvisor.com.au/Restaurants-g255060"), ResultCategory.DIRECTORY, "tripadvisor"),
        (_r("A cafe review", url="https://someblog.medium.com/a-cafe-review-123"), ResultCategory.ARTICLE, "medium.com"),
        (_r("News piece", url="https://www.abc.net.au/news/2024-01-01/story"), ResultCategory.NEWS, "abc.net.au"),
    ],
)
def test_drops_non_business_domains_with_category(result, category, needle):
    verdict = classify_result(result)
    assert verdict.is_business is False
    assert verdict.category is category
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
    verdict = classify_result(_r(title, url="https://randomsite.example/x"))
    assert verdict.is_business is False
    assert verdict.category in (ResultCategory.ARTICLE, ResultCategory.DIRECTORY)


def test_drops_results_flagged_as_articles_by_provider():
    result = _r("Local plumber profiled", url="https://trade-magazine.example/piece", is_article=True)
    assert _cat(result) is ResultCategory.ARTICLE


def test_result_subtype_maps_to_category():
    assert _cat(_r("Q", url="https://x.example/x", result_subtype="discussion")) is ResultCategory.FORUM
    assert _cat(_r("N", url="https://x.example/x", result_subtype="news")) is ResultCategory.NEWS
    assert _cat(_r("F", url="https://x.example/x", result_subtype="faq")) is ResultCategory.ARTICLE


def test_drops_article_forum_and_search_url_paths():
    assert _cat(_r("tips", url="https://trades.example/blog/plumbing-tips")) is ResultCategory.ARTICLE
    assert _cat(_r("t", url="https://trades.example/forum/thread/99")) is ResultCategory.FORUM
    assert _cat(_r("s", url="https://trades.example/search?q=plumber")) is ResultCategory.DIRECTORY


def test_drops_multi_business_directory_headlines():
    assert _cat(_r("Plumber Directory - Gold Coast Listings", url="https://x.example/")) is ResultCategory.DIRECTORY
