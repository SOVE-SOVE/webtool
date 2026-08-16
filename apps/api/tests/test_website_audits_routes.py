"""
Route tests for POST/GET /api/v1/leads/{id}/audits. The engine itself
(app/agents/website_audit.py) is mocked here — its correctness is
covered by test_website_audit_agent.py and the SSRF protections by
test_safe_http.py. These tests are about the storage/API contract:
auth, 404s, workspace isolation, and that a triggered audit is recorded
correctly (including the blocked/failed/success distinction).
"""

from app.agents.base import AgentResult
from app.agents.website_audit_schemas import (
    MobileResult,
    PerformanceResult,
    TechnicalResult,
    WebsiteAuditOutput,
)
from app.modules.website_audits import service as website_audits_service


def _success_result(url: str = "http://example.test") -> AgentResult[WebsiteAuditOutput]:
    output = WebsiteAuditOutput(
        url=url,
        final_url=url,
        reachable=True,
        technical=TechnicalResult(http_status=200, page_title="Example", https=False),
        performance=PerformanceResult(heuristic_speed_score=80),
        mobile=MobileResult(viewport_present=True),
        report_markdown="# audit report",
    )
    return AgentResult(output=output, flagged_for_review=False)


def _blocked_result(url: str) -> AgentResult[WebsiteAuditOutput]:
    output = WebsiteAuditOutput(
        url=url,
        reachable=False,
        blocked=True,
        block_reason="Host resolves to a disallowed address",
        report_markdown="blocked",
    )
    return AgentResult(output=output, flagged_for_review=True, notes="blocked")


def test_trigger_audit_requires_auth(client):
    res = client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/audits")
    assert res.status_code == 401


def test_trigger_audit_lead_not_found(authed_client):
    res = authed_client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/audits")
    assert res.status_code == 404


def test_trigger_audit_requires_website_url(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "No Website Co"}).json()
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/audits")
    assert res.status_code == 422


def test_trigger_audit_success_is_stored_and_returned(authed_client, monkeypatch):
    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Has Website Co", "website_url": "http://example.test"}
    ).json()

    monkeypatch.setattr(website_audits_service, "run_website_audit", lambda _input: _success_result())

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/audits")
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "success"
    assert body["has_existing_site"] is True
    assert body["https"] is False
    assert body["page_speed_score"] == 80
    assert body["mobile_friendly"] is True
    assert body["flagged_for_review"] is False
    assert body["results"]["technical"]["http_status"] == 200
    assert "audit report" in body["report_markdown"]

    activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "lead", "entity_id": lead["id"]}
    ).json()
    assert any(a["action"] == "website_audited" for a in activity)


def test_trigger_audit_blocked_is_stored_with_reason(authed_client, monkeypatch):
    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Sketchy Co", "website_url": "http://169.254.169.254/"}
    ).json()

    monkeypatch.setattr(
        website_audits_service, "run_website_audit", lambda input_: _blocked_result(input_.url)
    )

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/audits")
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "blocked"
    assert body["has_existing_site"] is False
    assert body["flagged_for_review"] is True
    assert body["error"] == "Host resolves to a disallowed address"


def test_list_audits_returns_newest_first(authed_client, monkeypatch):
    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Multi Audit Co", "website_url": "http://example.test"}
    ).json()
    monkeypatch.setattr(website_audits_service, "run_website_audit", lambda _input: _success_result())

    authed_client.post(f"/api/v1/leads/{lead['id']}/audits")
    authed_client.post(f"/api/v1/leads/{lead['id']}/audits")

    res = authed_client.get(f"/api/v1/leads/{lead['id']}/audits")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    assert body[0]["audited_at"] >= body[1]["audited_at"]


def test_list_audits_lead_not_found(authed_client):
    res = authed_client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000/audits")
    assert res.status_code == 404


def test_audits_scoped_to_own_workspace(authed_client, other_authed_client, monkeypatch):
    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Workspace One Co", "website_url": "http://example.test"}
    ).json()
    monkeypatch.setattr(website_audits_service, "run_website_audit", lambda _input: _success_result())
    authed_client.post(f"/api/v1/leads/{lead['id']}/audits")

    other_list = other_authed_client.get(f"/api/v1/leads/{lead['id']}/audits")
    assert other_list.status_code == 404

    other_trigger = other_authed_client.post(f"/api/v1/leads/{lead['id']}/audits")
    assert other_trigger.status_code == 404
