"""
Task 6 of Phase 2 ("Lead Intelligence") — the review workflow and CRM
import that completes the pipeline: discover -> research -> audit ->
score -> human review (approve/reject/archive) -> import into CRM.
Covers the full end-to-end path plus each review action, duplicate
prevention on import, and research/score preservation.
"""

import uuid

from app.integrations import search as search_integration
from app.integrations.browser import ResearchPageSignals
from app.integrations.search import SearchResult
from app.modules.businesses.models import Business
from app.modules.discovery.models import DiscoveredBusiness, DiscoveredBusinessStatus, DiscoverySearch
from app.modules.website_audits.models import WebsiteAudit


def _patch_discovery_and_research(monkeypatch, *, https=False, mobile_viewport_present=False):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Gold Coast Plumbing Co", url="https://gcplumbing.example", description="Local plumbers")
        ],
    )

    async def fake_fetch(url):
        return ResearchPageSignals(
            final_url=url,
            https=https,
            http_status=200,
            title="Gold Coast Plumbing Co" if https or mobile_viewport_present else None,
            meta_description="Local plumbers",
            viewport_meta_present=mobile_viewport_present,
            mobile_overflow=False,
            contact_cta_present=False,
            social_links=[],
            body_text="Copyright 2019 Gold Coast Plumbing Co",
            load_time_ms=5000,
        )

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)


def _run_discovery(authed_client) -> dict:
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing", "location": "Gold Coast"}).json()
    results = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()
    return results[0]


def test_full_workflow_discover_research_score_approve_import(authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)
    business_id = business["id"]

    research = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/research")
    assert research.status_code == 200

    audit = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/quality-audits")
    assert audit.status_code == 201
    assert audit.json()["issue_count"] > 0

    score = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/scores")
    assert score.status_code == 201
    assert score.json()["category"] == "hot"

    approved = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/approve")
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["reviewed_by_user_id"] is not None

    imported = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/import")
    assert imported.status_code == 200
    body = imported.json()
    assert body["status"] == "imported"
    assert body["imported_lead_id"] is not None

    lead_id = body["imported_lead_id"]
    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead["business_name"] == "Gold Coast Plumbing Co"
    assert lead["score"] == score.json()["overall_score"]
    assert lead["priority"] == "high"  # HOT category maps to high priority
    assert lead["source"] == "discovery:brave_search"

    # The review list should now reflect the imported state too.
    review = authed_client.get("/api/v1/discovered-businesses").json()
    row = next(r for r in review if r["id"] == business_id)
    assert row["status"] == "imported"
    assert row["opportunity_score"] == score.json()["overall_score"]
    assert row["quality_summary"]
    assert row["recommended_sales_angle"]


def test_contact_details_from_the_site_reach_the_imported_lead(authed_client, monkeypatch):
    """Discover -> research reads the site's tel:/mailto: -> import: the
    CRM lead's business has a real phone and email, not blanks the
    operator has to go and fill in by hand."""
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Gold Coast Plumbing Co", url="https://gcplumbing.example", description="Local plumbers")
        ],
    )

    async def fake_fetch(url):
        return ResearchPageSignals(
            final_url=url, https=True, http_status=200, title="Gold Coast Plumbing Co",
            viewport_meta_present=True, mobile_overflow=False, contact_cta_present=True,
            contact_phone="0411 871 875", contact_email="hello@gcplumbing.example",
            social_links=[], body_text="Copyright 2024 Gold Coast Plumbing Co", load_time_ms=800,
        )

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    business = _run_discovery(authed_client)
    authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/research")
    imported = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")
    lead = authed_client.get(f"/api/v1/leads/{imported.json()['imported_lead_id']}").json()

    assert lead["business_phone"] == "0411 871 875"
    assert lead["business_email"] == "hello@gcplumbing.example"


def test_import_preserves_research_as_website_audit(authed_client, db_session, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)
    business_id = business["id"]
    authed_client.post(f"/api/v1/discovered-businesses/{business_id}/research")
    authed_client.post(f"/api/v1/discovered-businesses/{business_id}/scores")

    imported = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/import")
    lead_id = imported.json()["imported_lead_id"]

    audits = db_session.query(WebsiteAudit).filter(WebsiteAudit.lead_id == lead_id).all()
    assert len(audits) == 1
    assert audits[0].https is False
    assert audits[0].load_time_ms == 5000

    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert "Opportunity score" in lead["notes"]
    assert "Research" in lead["notes"]


def test_import_without_any_prior_research_still_works(authed_client, monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: [
        SearchResult(title="No Research Co", url="https://noresearch.example", description="")
    ])
    business = _run_discovery(authed_client)

    imported = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")
    assert imported.status_code == 200
    lead_id = imported.json()["imported_lead_id"]
    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead["score"] is None


def test_import_returns_404_for_missing_business(authed_client):
    res = authed_client.post(f"/api/v1/discovered-businesses/{uuid.uuid4()}/import")
    assert res.status_code == 404


def test_cannot_reimport_already_imported_business(authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)
    authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")

    second = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")
    assert second.status_code == 400


def test_cannot_import_rejected_business(authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)
    authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/reject")

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")
    assert res.status_code == 400


def test_cannot_import_archived_business(authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)
    authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/archive")

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")
    assert res.status_code == 400


def test_import_prevents_duplicate_lead_when_business_already_has_one(authed_client, db_session, workspace, monkeypatch):
    existing_business = Business(workspace_id=workspace.id, name="Gold Coast Plumbing Co", website_url="https://gcplumbing.example")
    db_session.add(existing_business)
    db_session.commit()

    from app.modules.leads.models import Lead

    db_session.add(Lead(business_id=existing_business.id))
    db_session.commit()

    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)
    assert business["duplicate_of_business_id"] == str(existing_business.id)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")
    assert res.status_code == 409

    # No second lead was created for the existing business.
    from sqlalchemy import select

    leads = db_session.scalars(select(Lead).where(Lead.business_id == existing_business.id)).all()
    assert len(leads) == 1


def test_import_reuses_existing_business_without_a_lead(authed_client, db_session, workspace, monkeypatch):
    existing_business = Business(workspace_id=workspace.id, name="Gold Coast Plumbing Co", website_url="https://gcplumbing.example")
    db_session.add(existing_business)
    db_session.commit()

    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")
    assert res.status_code == 200

    lead = authed_client.get(f"/api/v1/leads/{res.json()['imported_lead_id']}").json()
    assert lead["business_id"] == str(existing_business.id)

    businesses = authed_client.get("/api/v1/businesses").json()
    assert len([b for b in businesses if b["name"] == "Gold Coast Plumbing Co"]) == 1


# --- Review actions -----------------------------------------------------------


def test_reject_business_with_notes(authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/reject", json={"notes": "Not a fit"})
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"
    assert res.json()["review_notes"] == "Not a fit"


def test_archive_business(authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/archive")
    assert res.status_code == 200
    assert res.json()["status"] == "archived"

    default_list = authed_client.get("/api/v1/discovered-businesses").json()
    assert business["id"] not in [b["id"] for b in default_list]

    with_archived = authed_client.get("/api/v1/discovered-businesses?include_archived=true").json()
    assert business["id"] in [b["id"] for b in with_archived]


def test_cannot_review_action_an_already_imported_business(authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)
    authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/import")

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/approve")
    assert res.status_code == 400


def test_bulk_approve(authed_client, monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Co One", url="https://co1.example", description=""),
            SearchResult(title="Co Two", url="https://co2.example", description=""),
        ],
    )
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()
    results = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()
    ids = [r["id"] for r in results]

    res = authed_client.post("/api/v1/discovered-businesses/bulk-approve", json={"business_ids": ids + [str(uuid.uuid4())]})

    assert res.status_code == 200
    body = res.json()
    assert len(body["approved"]) == 2
    assert all(b["status"] == "approved" for b in body["approved"])
    assert len(body["not_found"]) == 1


def test_review_actions_returns_404_for_missing_business(authed_client):
    assert authed_client.post(f"/api/v1/discovered-businesses/{uuid.uuid4()}/approve").status_code == 404
    assert authed_client.post(f"/api/v1/discovered-businesses/{uuid.uuid4()}/reject").status_code == 404
    assert authed_client.post(f"/api/v1/discovered-businesses/{uuid.uuid4()}/archive").status_code == 404


def test_review_actions_workspace_scoped(authed_client, other_authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)

    for action in ("approve", "reject", "archive", "import"):
        res = other_authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/{action}")
        assert res.status_code == 404


def test_review_list_returns_key_context_fields(authed_client, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    business = _run_discovery(authed_client)
    authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/research")
    authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/quality-audits")
    authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/scores")

    row = next(r for r in authed_client.get("/api/v1/discovered-businesses").json() if r["id"] == business["id"])

    assert row["name"] == "Gold Coast Plumbing Co"
    assert row["industry"] == "Plumbing"
    assert row["website_url"] == "https://gcplumbing.example"
    assert row["quality_summary"]
    assert len(row["key_problems"]) > 0
    assert row["opportunity_score"] is not None
    assert row["score_category"] == "hot"
    assert row["confidence"] is not None
    assert row["recommended_sales_angle"]
    assert row["source_provider"] == "brave_search"
    assert row["researched_at"] is not None
