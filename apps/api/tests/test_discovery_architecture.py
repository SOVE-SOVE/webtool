"""
Task 1 of Phase 2 ("Lead Intelligence") — architecture only, no provider
integration yet. These tests exercise the schema/service/route skeleton
directly (creating rows via `db_session`, same pattern as other entities
without a POST route yet — see tests/conftest.py's `db_session` fixture
docstring): model round-trips, workspace isolation, and empty-state
behavior for the list/get routes. Business-discovery *logic* (running a
search, deduplication, provider normalization) is covered separately
once that capability is built.
"""

import uuid

from app.modules.business_research.models import BusinessResearchResult
from app.modules.discovery.models import (
    DiscoveredBusiness,
    DiscoveredBusinessStatus,
    DiscoverySearch,
    OpportunityScoreCategory,
)
from app.modules.opportunity_scoring.models import OpportunityScoreResult
from app.modules.website_quality.models import WebsiteQualityAudit


def _make_search(db_session, workspace, **overrides) -> DiscoverySearch:
    defaults = dict(
        workspace_id=workspace.id,
        location="Gold Coast",
        industry="Plumbing",
        provider="manual",
    )
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
        suburb="Southport",
        state="QLD",
        source_provider="manual",
        dedup_key="gold coast plumbing co|southport|qld",
    )
    defaults.update(overrides)
    business = DiscoveredBusiness(**defaults)
    db_session.add(business)
    db_session.commit()
    db_session.refresh(business)
    return business


def test_discovery_search_round_trip(db_session, workspace):
    search = _make_search(db_session, workspace)
    assert search.id is not None
    assert search.status.value == "pending"
    assert search.result_count == 0


def test_discovered_business_round_trip(db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    assert business.status == DiscoveredBusinessStatus.NEW
    assert business.discovery_search_id == search.id
    assert business.opportunity_score is None


def test_list_discovery_searches_empty_for_new_workspace(authed_client):
    res = authed_client.get("/api/v1/discovery-searches")
    assert res.status_code == 200
    assert res.json() == []


def test_list_and_get_discovery_search(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace, query_label="Plumbers on the Gold Coast")

    listed = authed_client.get("/api/v1/discovery-searches").json()
    assert [s["id"] for s in listed] == [str(search.id)]
    assert listed[0]["query_label"] == "Plumbers on the Gold Coast"

    fetched = authed_client.get(f"/api/v1/discovery-searches/{search.id}")
    assert fetched.status_code == 200
    assert fetched.json()["industry"] == "Plumbing"


def test_get_discovery_search_not_found(authed_client):
    res = authed_client.get(f"/api/v1/discovery-searches/{uuid.uuid4()}")
    assert res.status_code == 404


def test_discovery_search_scoped_to_own_workspace(authed_client, other_authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)

    other_list = other_authed_client.get("/api/v1/discovery-searches").json()
    assert search.id.__str__() not in [s["id"] for s in other_list]

    other_get = other_authed_client.get(f"/api/v1/discovery-searches/{search.id}")
    assert other_get.status_code == 404

    other_results = other_authed_client.get(f"/api/v1/discovery-searches/{search.id}/results")
    assert other_results.status_code == 404


def test_list_results_for_search_with_no_businesses(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    res = authed_client.get(f"/api/v1/discovery-searches/{search.id}/results")
    assert res.status_code == 200
    assert res.json() == []


def test_list_results_not_found_for_missing_search(authed_client):
    res = authed_client.get(f"/api/v1/discovery-searches/{uuid.uuid4()}/results")
    assert res.status_code == 404


def test_get_discovered_business(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    res = authed_client.get(f"/api/v1/discovered-businesses/{business.id}")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Gold Coast Plumbing Co"
    assert body["status"] == "new"


def test_discovered_business_scoped_to_own_workspace(authed_client, other_authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    res = other_authed_client.get(f"/api/v1/discovered-businesses/{business.id}")
    assert res.status_code == 404


def test_research_quality_score_routes_empty_and_workspace_scoped(
    authed_client, other_authed_client, db_session, workspace
):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    for suffix in ("research", "quality-audits", "scores"):
        res = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/{suffix}")
        assert res.status_code == 200
        assert res.json() == []

        other_res = other_authed_client.get(f"/api/v1/discovered-businesses/{business.id}/{suffix}")
        assert other_res.status_code == 404


def test_business_research_result_round_trip(db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    result = BusinessResearchResult(
        discovered_business_id=business.id,
        official_website_url="https://example.com",
        website_reachable=True,
        confirmed_facts="Website returned HTTP 200",
        inferred_facts="Likely uses an older template based on layout",
        unavailable_fields="Social media presence",
    )
    db_session.add(result)
    db_session.commit()
    db_session.refresh(result)

    assert result.discovered_business_id == business.id
    assert result.website_reachable is True


def test_website_quality_audit_findings_round_trip(db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    audit = WebsiteQualityAudit(
        discovered_business_id=business.id,
        findings=[
            {
                "category": "mobile_usability",
                "severity": "high",
                "message": "No mobile viewport tag found",
                "evidence": "meta[name=viewport] absent from fetched HTML",
                "confidence": 0.95,
            }
        ],
        issue_count=1,
        critical_count=0,
    )
    db_session.add(audit)
    db_session.commit()
    db_session.refresh(audit)

    assert len(audit.findings) == 1
    assert audit.findings[0]["category"] == "mobile_usability"


def test_opportunity_score_result_round_trip(db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    score = OpportunityScoreResult(
        discovered_business_id=business.id,
        overall_score=78,
        category=OpportunityScoreCategory.HOT,
        confidence=0.8,
        positive_signals="No website on record",
        negative_signals="",
        factors=[{"factor": "no_website", "points": 40, "direction": "positive", "explanation": "No site found"}],
        recommendation_reason="No existing website — strong redesign opportunity",
    )
    db_session.add(score)
    db_session.commit()
    db_session.refresh(score)

    assert score.overall_score == 78
    assert score.category.value == "hot"
