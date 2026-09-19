"""
Regression tests for the misleading Review Queue states found on
2026-09-19 (see docs/07_SESSION_LOG.md):

1. A transient DNS failure was recorded as a failed analysis after one lookup.
2. A failed analysis scored 90-95 HOT ("site_unreachable").
3. A Facebook/Instagram URL was presented as an owned "Website found" and
   sent to the browser as if it were one.
4. A failed research result was cached for 7 days, so "Retry" returned the
   stored failure instead of retrying.
"""

import socket
from datetime import datetime, timedelta, timezone

import pytest

from app.agents import business_research as business_research_agent
from app.agents.business_research import BusinessResearchAgentInput
from app.integrations import browser
from app.integrations.website_kind import classify_website_url, social_platform
from app.modules.business_research.models import BusinessResearchResult
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch

# --- 1. DNS: retry before concluding a lookup failed ---------------------------


def test_transient_dns_failure_is_retried_and_succeeds(monkeypatch):
    calls = {"n": 0}

    def flaky(host, port):
        calls["n"] += 1
        if calls["n"] < 3:
            raise socket.gaierror(8, "nodename nor servname provided, or not known")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]

    monkeypatch.setattr(browser.socket, "getaddrinfo", flaky)
    monkeypatch.setattr(browser, "DNS_RETRY_DELAY_SECONDS", 0)

    browser._check_url_is_public("https://www.facebook.example/")  # must not raise

    assert calls["n"] == 3


def test_persistent_dns_failure_still_fails_after_bounded_attempts(monkeypatch):
    calls = {"n": 0}

    def dead(host, port):
        calls["n"] += 1
        raise socket.gaierror(8, "nodename nor servname provided, or not known")

    monkeypatch.setattr(browser.socket, "getaddrinfo", dead)
    monkeypatch.setattr(browser, "DNS_RETRY_DELAY_SECONDS", 0)

    with pytest.raises(browser.UrlNotAllowedError, match="Could not resolve hostname"):
        browser._check_url_is_public("https://nonexistent.example/")

    assert calls["n"] == browser.DNS_ATTEMPTS


# --- 3. Social profiles are not owned websites ---------------------------------


@pytest.mark.parametrize(
    "url,platform",
    [
        ("https://www.facebook.com/somebutcher", "Facebook"),
        ("https://m.facebook.com/x", "Facebook"),
        ("http://instagram.com/x", "Instagram"),
        ("https://linktr.ee/x", "Linktree"),
        ("facebook.com/x", "Facebook"),
        ("https://l.facebook.com/l.php?u=x", "Facebook"),
    ],
)
def test_social_urls_are_classified_as_profiles(url, platform):
    assert social_platform(url) == platform
    assert classify_website_url(url) == "social_profile"


@pytest.mark.parametrize(
    "url", ["https://notfacebook.com", "https://facebook.com.au", "https://butcherbrothers.com.au", "https://example.com/facebook.com"]
)
def test_lookalike_and_ordinary_domains_are_owned_websites(url):
    assert classify_website_url(url) == "website"


def test_no_url_has_no_kind():
    assert classify_website_url(None) is None
    assert classify_website_url("  ") is None


def test_research_does_not_load_a_social_profile(monkeypatch):
    async def must_not_be_called(url):
        raise AssertionError("a social profile must not be sent to the browser")

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", must_not_be_called)

    result = business_research_agent.run(BusinessResearchAgentInput(website_url="https://www.facebook.com/x"))

    assert result.output.research_error is None  # not a failure...
    assert result.output.website_reachable is None  # ...and not a verdict on any site
    assert "Facebook profile, not an owned website" in result.output.confirmed_facts[0]


def test_failed_load_leaves_reachability_unknown_not_false(monkeypatch):
    from app.integrations.browser import ResearchPageSignals

    async def fake(url):
        return ResearchPageSignals(error="Could not resolve hostname 'x.example'")

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake)
    result = business_research_agent.run(BusinessResearchAgentInput(website_url="https://x.example"))

    assert result.output.website_reachable is None
    assert result.output.research_error


# --- API-level helpers ---------------------------------------------------------


def _business(db, workspace, **kw):
    search = DiscoverySearch(workspace_id=workspace.id, industry="Butcher", provider="manual")
    db.add(search)
    db.commit()
    d = dict(
        discovery_search_id=search.id,
        name="Test Butcher",
        source_provider="manual",
        dedup_key="test-butcher",
        website_url="https://butcher.example",
        review_queued_at=datetime.now(timezone.utc),
    )
    d.update(kw)
    b = DiscoveredBusiness(**d)
    db.add(b)
    db.commit()
    return b


def _research(db, business, **kw):
    r = BusinessResearchResult(discovered_business_id=business.id, **kw)
    db.add(r)
    db.commit()
    return r


# --- 2. Scoring through the service: failure => unavailable, history kept -------


def test_scoring_a_failed_analysis_yields_unavailable_score_and_clears_cached_score(
    authed_client, db_session, workspace
):
    b = _business(db_session, workspace, phone="0400000000", opportunity_score=95)
    _research(db_session, b, website_reachable=False, research_error="Could not resolve hostname 'x'")

    res = authed_client.post(f"/api/v1/discovered-businesses/{b.id}/scores")

    assert res.status_code == 201
    body = res.json()
    assert body["overall_score"] is None and body["category"] == "review"
    db_session.refresh(b)
    assert b.opportunity_score is None  # cache no longer shows the stale 95
    scores = authed_client.get(f"/api/v1/discovered-businesses/{b.id}/scores").json()
    assert len(scores) == 1


def test_scoring_a_social_profile_url_is_unavailable_not_a_site_score(authed_client, db_session, workspace):
    b = _business(db_session, workspace, website_url="https://www.facebook.com/somebutcher")
    _research(db_session, b, website_reachable=None)  # what research now records for a social URL

    body = authed_client.post(f"/api/v1/discovered-businesses/{b.id}/scores").json()

    assert body["overall_score"] is None
    assert [f["factor"] for f in body["factors"]] == ["social_profile_only"]


def test_genuine_successful_analysis_still_scores_normally(authed_client, db_session, workspace):
    b = _business(db_session, workspace)
    _research(db_session, b, website_reachable=True, https=False, mobile_viewport_present=False, load_time_ms=5000, contact_cta_present=False)

    body = authed_client.post(f"/api/v1/discovered-businesses/{b.id}/scores").json()

    assert body["overall_score"] is not None and body["overall_score"] >= 70


# --- 4. Retry really retries ----------------------------------------------------


def test_retry_reruns_after_a_recent_failed_result_but_reuses_a_recent_success(
    authed_client, db_session, workspace, monkeypatch
):
    from app.integrations.browser import ResearchPageSignals

    runs = {"n": 0}

    async def fake(url):
        runs["n"] += 1
        return ResearchPageSignals(final_url=url, https=True, http_status=200, title="T", viewport_meta_present=True, contact_cta_present=True, load_time_ms=900)

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake)
    b = _business(db_session, workspace)
    _research(db_session, b, website_reachable=False, research_error="Timeout", researched_at=datetime.now(timezone.utc) - timedelta(minutes=5))

    first = authed_client.post(f"/api/v1/discovered-businesses/{b.id}/research").json()
    assert runs["n"] == 1 and first["research_error"] is None  # failure was NOT served from cache

    authed_client.post(f"/api/v1/discovered-businesses/{b.id}/research")
    assert runs["n"] == 1  # a fresh success is still reused (no repeated paid work)


# --- Review queue payload -------------------------------------------------------


def test_review_queue_payload_marks_social_profiles_and_keeps_failures_distinct(authed_client, db_session, workspace):
    b = _business(db_session, workspace, website_url="https://www.facebook.com/somebutcher")
    page = authed_client.get("/api/v1/discovered-businesses/review-queue").json()
    item = next(i for i in page["items"] if i["id"] == str(b.id))
    assert item["website_kind"] == "social_profile" and item["website_platform"] == "Facebook"
    assert item["opportunity_score"] is None
