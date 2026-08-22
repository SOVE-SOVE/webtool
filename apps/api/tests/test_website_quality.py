"""
Task 4 of Phase 2 ("Lead Intelligence"): website quality analysis.
Every finding must carry category/severity/evidence/confidence and must
never claim a measurement the underlying research didn't actually make
— covers the agent's finding logic directly, plus the service/route
layer (requires research first, persists, advances status).
"""

import uuid

from app.agents import website_quality as website_quality_agent
from app.agents.website_quality import WebsiteQualityInput
from app.modules.business_research.models import BusinessResearchResult
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


def _make_research(db_session, business, **overrides) -> BusinessResearchResult:
    defaults = dict(
        discovered_business_id=business.id,
        official_website_url=business.website_url,
        website_reachable=True,
        https=True,
        mobile_viewport_present=True,
        load_time_ms=1200,
        contact_cta_present=True,
        page_title="Gold Coast Plumbing Co",
        meta_description="Local plumbers",
        appears_template_or_placeholder=None,
    )
    defaults.update(overrides)
    research = BusinessResearchResult(**defaults)
    db_session.add(research)
    db_session.commit()
    db_session.refresh(research)
    return research


# --- Agent: findings ---------------------------------------------------------


def test_unreachable_site_produces_only_availability_finding():
    result = website_quality_agent.run(
        WebsiteQualityInput(website_reachable=False, research_error="Timeout")
    )

    assert len(result.output.findings) == 1
    finding = result.output.findings[0]
    assert finding.category == "availability"
    assert finding.severity == "critical"
    assert finding.evidence == "Timeout"
    assert result.flagged_for_review is True


def test_no_website_on_record_produces_no_findings_and_no_spurious_missing_field_claims():
    """website_reachable=None (no URL at all — see agents/business_research.py) must not fall
    through to the falsy-checks below and report "missing title"/"missing meta description"
    for a page that was never expected to exist."""
    result = website_quality_agent.run(
        WebsiteQualityInput(website_reachable=None, page_title=None, meta_description=None)
    )

    assert result.output.findings == []


def test_clean_site_produces_no_findings():
    result = website_quality_agent.run(
        WebsiteQualityInput(
            website_reachable=True,
            https=True,
            mobile_viewport_present=True,
            load_time_ms=800,
            contact_cta_present=True,
            page_title="Real Business",
            meta_description="A real description",
            appears_template_or_placeholder=None,
        )
    )

    assert result.output.findings == []
    assert "No significant issues" in result.output.summary


def test_every_finding_has_required_fields():
    result = website_quality_agent.run(
        WebsiteQualityInput(
            website_reachable=True,
            https=False,
            mobile_viewport_present=False,
            load_time_ms=5000,
            contact_cta_present=False,
            page_title=None,
            meta_description=None,
            appears_template_or_placeholder=True,
        )
    )

    assert len(result.output.findings) >= 6
    for finding in result.output.findings:
        assert finding.category
        assert finding.severity in ("low", "medium", "high", "critical")
        assert finding.message
        assert finding.evidence
        assert 0.0 <= finding.confidence <= 1.0


def test_https_finding_only_when_false():
    no_finding = website_quality_agent.run(WebsiteQualityInput(website_reachable=True, https=True))
    assert not any(f.category == "security" for f in no_finding.output.findings)

    has_finding = website_quality_agent.run(WebsiteQualityInput(website_reachable=True, https=False))
    assert any(f.category == "security" for f in has_finding.output.findings)


def test_https_unknown_produces_no_finding():
    result = website_quality_agent.run(WebsiteQualityInput(website_reachable=True, https=None))
    assert not any(f.category == "security" for f in result.output.findings)


def test_performance_severity_scales_with_load_time():
    fast = website_quality_agent.run(WebsiteQualityInput(website_reachable=True, load_time_ms=1000))
    moderate = website_quality_agent.run(WebsiteQualityInput(website_reachable=True, load_time_ms=3000))
    slow = website_quality_agent.run(WebsiteQualityInput(website_reachable=True, load_time_ms=5000))

    assert not any(f.category == "performance" for f in fast.output.findings)
    moderate_finding = next(f for f in moderate.output.findings if f.category == "performance")
    assert moderate_finding.severity == "medium"
    slow_finding = next(f for f in slow.output.findings if f.category == "performance")
    assert slow_finding.severity == "high"


def test_load_time_unknown_produces_no_performance_finding():
    result = website_quality_agent.run(WebsiteQualityInput(website_reachable=True, load_time_ms=None))
    assert not any(f.category == "performance" for f in result.output.findings)


def test_missing_title_and_meta_description_are_separate_findings():
    result = website_quality_agent.run(
        WebsiteQualityInput(website_reachable=True, page_title=None, meta_description=None)
    )
    categories = [f.category for f in result.output.findings]
    assert categories.count("business_information") == 2


# --- Service/route ------------------------------------------------------------


def test_audit_requires_research_first(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/quality-audits")
    assert res.status_code == 400


def test_audit_returns_404_for_missing_business(authed_client):
    res = authed_client.post(f"/api/v1/discovered-businesses/{uuid.uuid4()}/quality-audits")
    assert res.status_code == 404


def test_audit_persists_and_advances_status(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search, status=DiscoveredBusinessStatus.RESEARCHED)
    _make_research(db_session, business, https=False, mobile_viewport_present=False)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/quality-audits")

    assert res.status_code == 201
    body = res.json()
    assert body["issue_count"] >= 2
    categories = {f["category"] for f in body["findings"]}
    assert "security" in categories
    assert "mobile_usability" in categories

    db_session.refresh(business)
    assert business.status == DiscoveredBusinessStatus.AUDITED


def test_audit_critical_count_reflects_unreachable_site(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)
    _make_research(db_session, business, website_reachable=False, research_error="DNS error", https=None)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/quality-audits")

    body = res.json()
    assert body["critical_count"] == 1
    assert body["issue_count"] == 1


def test_list_quality_audits_workspace_scoped(authed_client, other_authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)
    _make_research(db_session, business)
    authed_client.post(f"/api/v1/discovered-businesses/{business.id}/quality-audits")

    mine = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/quality-audits").json()
    assert len(mine) == 1

    other = other_authed_client.get(f"/api/v1/discovered-businesses/{business.id}/quality-audits")
    assert other.status_code == 404
