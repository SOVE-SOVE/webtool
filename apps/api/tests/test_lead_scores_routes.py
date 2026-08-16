"""
Route tests for POST/GET /api/v1/leads/{id}/scores. The scoring engine
itself is covered by test_lead_score_agent.py — these tests are about
the storage/API contract: auth, 404s, workspace isolation, that scoring
picks up the lead's latest website audit, and that re-scoring preserves
history rather than overwriting the previous score.
"""

from app.agents.base import AgentResult
from app.agents.lead_score_schemas import CategoryScore, Confidence, LeadScoreOutput
from app.agents.website_audit_schemas import TechnicalResult, WebsiteAuditOutput
from app.modules.lead_scores import service as lead_scores_service
from app.modules.website_audits import service as website_audits_service


def _fake_score_result(overall: int = 42) -> AgentResult[LeadScoreOutput]:
    output = LeadScoreOutput(
        overall_score=overall,
        confidence=Confidence.MEDIUM,
        categories=[
            CategoryScore(key="website_opportunity", label="Website improvement opportunity", score=80, weight=25, confidence=Confidence.HIGH)
        ],
        warnings=["Commercial value is inferred..."],
        config_version=1,
    )
    return AgentResult(output=output, flagged_for_review=False)


def test_trigger_score_requires_auth(client):
    res = client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/scores")
    assert res.status_code == 401


def test_trigger_score_lead_not_found(authed_client):
    res = authed_client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/scores")
    assert res.status_code == 404


def test_trigger_score_stores_and_updates_lead_score(authed_client, monkeypatch):
    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Scoreable Co", "industry": "plumbing"}
    ).json()

    monkeypatch.setattr(lead_scores_service, "run_lead_score", lambda _input: _fake_score_result(77))

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/scores")
    assert res.status_code == 201
    body = res.json()
    assert body["overall_score"] == 77
    assert body["confidence"] == "medium"
    assert body["based_on_audit_id"] is None
    assert body["results"]["categories"][0]["key"] == "website_opportunity"

    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["score"] == 77

    activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "lead", "entity_id": lead["id"]}
    ).json()
    assert any(a["action"] == "scored" for a in activity)


def test_rescoring_preserves_previous_scores(authed_client, monkeypatch):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "History Co"}).json()

    monkeypatch.setattr(lead_scores_service, "run_lead_score", lambda _input: _fake_score_result(30))
    authed_client.post(f"/api/v1/leads/{lead['id']}/scores")

    monkeypatch.setattr(lead_scores_service, "run_lead_score", lambda _input: _fake_score_result(85))
    authed_client.post(f"/api/v1/leads/{lead['id']}/scores")

    history = authed_client.get(f"/api/v1/leads/{lead['id']}/scores").json()
    assert len(history) == 2
    scores = {item["overall_score"] for item in history}
    assert scores == {30, 85}
    # Newest first, and the lead's quick-glance score reflects the latest run.
    assert history[0]["overall_score"] == 85
    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["score"] == 85


def test_score_picks_up_latest_website_audit(authed_client, monkeypatch):
    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Audited Co", "website_url": "http://example.test"}
    ).json()

    # A minimal real-shaped audit result rather than re-running the real
    # engine (no network access in tests) — see test_website_audit_agent.py
    # for engine correctness itself.
    audit_output = WebsiteAuditOutput(
        url="http://example.test", final_url="http://example.test", reachable=True,
        technical=TechnicalResult(http_status=200, https=True),
    )
    monkeypatch.setattr(
        website_audits_service, "run_website_audit", lambda _input: AgentResult(output=audit_output, flagged_for_review=False)
    )
    audit = authed_client.post(f"/api/v1/leads/{lead['id']}/audits").json()

    # Real scoring engine this time (not mocked) — confirms the service
    # layer actually wires the latest audit into the scoring input.
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/scores")
    assert res.status_code == 201
    body = res.json()
    assert body["based_on_audit_id"] == audit["id"]
    website_opportunity = next(c for c in body["results"]["categories"] if c["key"] == "website_opportunity")
    # The fake audit is reachable with https=True and no other issues, so
    # the "no_website" rule should NOT have fired.
    assert all(r["rule_id"] != "no_website" for r in website_opportunity["reasons"])


def test_list_scores_lead_not_found(authed_client):
    res = authed_client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000/scores")
    assert res.status_code == 404


def test_scores_scoped_to_own_workspace(authed_client, other_authed_client, monkeypatch):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Co"}).json()
    monkeypatch.setattr(lead_scores_service, "run_lead_score", lambda _input: _fake_score_result())
    authed_client.post(f"/api/v1/leads/{lead['id']}/scores")

    other_list = other_authed_client.get(f"/api/v1/leads/{lead['id']}/scores")
    assert other_list.status_code == 404

    other_trigger = other_authed_client.post(f"/api/v1/leads/{lead['id']}/scores")
    assert other_trigger.status_code == 404
