"""
Task 3 of Phase 2 ("Lead Intelligence"): website research for discovered
businesses. Covers the agent's confirmed/inferred/unavailable
classification directly, plus the service/route layer's caching (don't
re-research a fresh result) and API behavior.
"""

import uuid
from datetime import datetime, timedelta, timezone

from app.agents import business_research as business_research_agent
from app.agents.business_research import BusinessResearchAgentInput
from app.integrations.browser import ResearchPageSignals
from app.modules.business_research.models import BusinessResearchResult
from app.modules.business_research.service import RESEARCH_FRESHNESS
from app.modules.discovery.models import DiscoveredBusiness, DiscoveredBusinessStatus, DiscoverySearch


def _make_search(db_session, workspace, **overrides) -> DiscoverySearch:
    defaults = dict(workspace_id=workspace.id, industry="Plumbing", provider="manual")
    defaults.update(overrides)
    search = DiscoverySearch(**defaults)
    db_session.add(search)
    db_session.commit()
    db_session.refresh(search)
    return search


def _make_discovered_business(db_session, search, **overrides) -> DiscoveredBusiness:
    defaults = dict(
        discovery_search_id=search.id,
        name="Gold Coast Plumbing Co",
        website_url="https://gcplumbing.example",
        source_provider="manual",
        dedup_key="gold coast plumbing co||",
    )
    defaults.update(overrides)
    business = DiscoveredBusiness(**defaults)
    db_session.add(business)
    db_session.commit()
    db_session.refresh(business)
    return business


# --- Agent: confirmed / inferred / unavailable classification --------------


def test_research_no_website_url():
    result = business_research_agent.run(BusinessResearchAgentInput(website_url=None))

    assert result.output.website_reachable is None
    assert "No website URL on record" in result.output.confirmed_facts
    assert "Website reachability" in result.output.unavailable_fields


def test_research_unreachable_site_flags_for_review(monkeypatch):
    async def fake_fetch(url):
        return ResearchPageSignals(error="net::ERR_CONNECTION_REFUSED")

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    result = business_research_agent.run(BusinessResearchAgentInput(website_url="https://down.example"))

    assert result.output.website_reachable is False
    assert result.output.research_error == "net::ERR_CONNECTION_REFUSED"
    assert result.flagged_for_review is True


def test_research_full_signals_classification(monkeypatch):
    async def fake_fetch(url):
        return ResearchPageSignals(
            final_url=url,
            https=True,
            http_status=200,
            title="Gold Coast Plumbing Co",
            meta_description="Local plumbers",
            viewport_meta_present=True,
            mobile_overflow=False,
            generator_meta="WordPress 6.4",
            contact_cta_present=True,
            social_links=["https://facebook.com/gcplumbing"],
            body_text="Copyright © 2019 Gold Coast Plumbing Co. All rights reserved.",
            load_time_ms=900,
        )

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    result = business_research_agent.run(BusinessResearchAgentInput(website_url="https://gcplumbing.example"))
    output = result.output

    assert output.website_reachable is True
    assert output.https is True
    assert output.mobile_viewport_present is True
    assert output.contact_cta_present is True
    assert output.load_time_ms == 900
    assert output.social_presence == ["https://facebook.com/gcplumbing"]
    assert output.estimated_site_age is not None
    assert "2019" in output.estimated_site_age
    assert any("2019" in fact for fact in output.confirmed_facts)
    assert any("WordPress" in fact for fact in output.inferred_facts)
    assert output.technical_issues == []
    # Nothing here counts as an unavailable field — everything was measured.
    assert output.unavailable_fields == []


def test_research_detects_placeholder_text(monkeypatch):
    async def fake_fetch(url):
        return ResearchPageSignals(
            final_url=url,
            https=True,
            http_status=200,
            title="Untitled Site",
            viewport_meta_present=False,
            mobile_overflow=False,
            contact_cta_present=False,
            social_links=[],
            body_text="Welcome to our site. Lorem ipsum dolor sit amet.",
        )

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    result = business_research_agent.run(BusinessResearchAgentInput(website_url="https://placeholder.example"))
    output = result.output

    assert output.appears_template_or_placeholder is True
    assert any("placeholder" in issue.lower() for issue in output.technical_issues)
    assert "No mobile viewport tag" in output.technical_issues
    assert "No obvious contact method (no mailto/tel link or form)" in output.technical_issues


def test_research_no_placeholder_evidence_is_undetermined_not_false(monkeypatch):
    async def fake_fetch(url):
        return ResearchPageSignals(
            final_url=url, https=True, http_status=200, title="A Real Site",
            viewport_meta_present=True, mobile_overflow=False, contact_cta_present=True,
            social_links=[], body_text="Welcome to our real business.",
        )

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    result = business_research_agent.run(BusinessResearchAgentInput(website_url="https://real.example"))

    # Absence of placeholder text doesn't prove it ISN'T a template —
    # never claim more certainty than the evidence supports.
    assert result.output.appears_template_or_placeholder is None


def test_research_implausible_copyright_year_is_ignored(monkeypatch):
    async def fake_fetch(url):
        return ResearchPageSignals(
            final_url=url, https=True, http_status=200, title="Old Co",
            viewport_meta_present=True, mobile_overflow=False, contact_cta_present=True,
            social_links=[], body_text="Call us on © 1920 5551234 today",
        )

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    result = business_research_agent.run(BusinessResearchAgentInput(website_url="https://old.example"))

    assert result.output.estimated_site_age is None
    assert "Website age (no copyright year found in the page text)" in result.output.unavailable_fields


# --- Service/route: caching and persistence ---------------------------------


def _patch_full_signals(monkeypatch):
    async def fake_fetch(url):
        return ResearchPageSignals(
            final_url=url, https=True, http_status=200, title="Gold Coast Plumbing Co",
            meta_description="Local plumbers", viewport_meta_present=True, mobile_overflow=False,
            contact_cta_present=True, social_links=["https://facebook.com/gcplumbing"],
            body_text="Copyright 2022 Gold Coast Plumbing Co",
        )

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)


def test_run_research_persists_result_and_advances_status(authed_client, db_session, workspace, monkeypatch):
    _patch_full_signals(monkeypatch)
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/research")

    assert res.status_code == 200
    body = res.json()
    assert body["official_website_url"] == "https://gcplumbing.example"
    assert body["website_reachable"] is True
    assert any("Gold Coast Plumbing Co" in f for f in body["confirmed_facts"])

    db_session.refresh(business)
    assert business.status == DiscoveredBusinessStatus.RESEARCHED


def test_run_research_returns_404_for_missing_business(authed_client):
    res = authed_client.post(f"/api/v1/discovered-businesses/{uuid.uuid4()}/research")
    assert res.status_code == 404


def test_run_research_uses_cached_result_within_freshness_window(authed_client, db_session, workspace, monkeypatch):
    call_count = 0

    async def fake_fetch(url):
        nonlocal call_count
        call_count += 1
        return ResearchPageSignals(final_url=url, https=True, http_status=200, title="Cached Co")

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    first = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/research")
    second = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/research")

    assert call_count == 1  # the second call reused the cached result
    assert first.json()["id"] == second.json()["id"]


def test_run_research_refetches_after_freshness_window_expires(authed_client, db_session, workspace, monkeypatch):
    _patch_full_signals(monkeypatch)
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    stale = BusinessResearchResult(
        discovered_business_id=business.id,
        official_website_url=business.website_url,
        website_reachable=True,
        confirmed_facts="Old research",
    )
    db_session.add(stale)
    db_session.commit()
    db_session.execute(
        BusinessResearchResult.__table__.update()
        .where(BusinessResearchResult.id == stale.id)
        .values(researched_at=datetime.now(timezone.utc) - RESEARCH_FRESHNESS - timedelta(days=1))
    )
    db_session.commit()

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/research")

    assert res.status_code == 200
    assert res.json()["id"] != str(stale.id)


def test_list_research_results_workspace_scoped(authed_client, other_authed_client, db_session, workspace, monkeypatch):
    _patch_full_signals(monkeypatch)
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)
    authed_client.post(f"/api/v1/discovered-businesses/{business.id}/research")

    mine = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/research").json()
    assert len(mine) == 1

    other = other_authed_client.get(f"/api/v1/discovered-businesses/{business.id}/research")
    assert other.status_code == 404
