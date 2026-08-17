from tests.test_outreach import FAKE_EMAIL
from tests.test_sales_audits import FAKE_LLM_OUTPUT


def _create_lead(authed_client, **overrides):
    payload = {"business_name": "Test Co"}
    payload.update(overrides)
    lead = authed_client.post("/api/v1/leads", json=payload).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified"})
    return lead


def _patch_sales_audit(monkeypatch):
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(FAKE_LLM_OUTPUT))
    monkeypatch.setattr("app.integrations.search.search_business", lambda query: None)


def test_generation_rate_limit_blocks_after_max_calls(authed_client, monkeypatch):
    monkeypatch.setattr("app.core.rate_limit.settings.llm_rate_limit_per_minute", 2)
    _patch_sales_audit(monkeypatch)
    lead = _create_lead(authed_client)

    assert authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits").status_code == 201
    assert authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits").status_code == 201
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    assert res.status_code == 429
    assert "Rate limit" in res.json()["detail"]


def test_generation_rate_limit_shared_across_sales_audit_and_outreach(authed_client, monkeypatch):
    monkeypatch.setattr("app.core.rate_limit.settings.llm_rate_limit_per_minute", 1)
    _patch_sales_audit(monkeypatch)
    monkeypatch.setattr("app.agents.outreach.generate_structured", lambda **kwargs: dict(FAKE_EMAIL))
    lead = _create_lead(authed_client)

    assert authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits").status_code == 201
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"})
    assert res.status_code == 429


def test_generation_rate_limit_is_per_user_not_global(authed_client, other_authed_client, monkeypatch):
    monkeypatch.setattr("app.core.rate_limit.settings.llm_rate_limit_per_minute", 1)
    _patch_sales_audit(monkeypatch)
    lead_a = _create_lead(authed_client)
    lead_b_res = other_authed_client.post("/api/v1/leads", json={"business_name": "Other Co"})
    lead_b = lead_b_res.json()
    other_authed_client.patch(f"/api/v1/leads/{lead_b['id']}", json={"status": "qualified"})

    assert authed_client.post(f"/api/v1/leads/{lead_a['id']}/sales-audits").status_code == 201
    assert authed_client.post(f"/api/v1/leads/{lead_a['id']}/sales-audits").status_code == 429
    # A different user's own budget is untouched by lead_a's owner hitting their limit.
    assert other_authed_client.post(f"/api/v1/leads/{lead_b['id']}/sales-audits").status_code == 201


def test_rate_limit_does_not_affect_read_or_lifecycle_endpoints(authed_client, monkeypatch):
    monkeypatch.setattr("app.core.rate_limit.settings.llm_rate_limit_per_minute", 1)
    _patch_sales_audit(monkeypatch)
    lead = _create_lead(authed_client)

    assert authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits").status_code == 201
    assert authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits").status_code == 429

    # Reads aren't gated by the generation limiter at all.
    assert authed_client.get(f"/api/v1/leads/{lead['id']}/sales-audits").status_code == 200
    assert authed_client.get("/api/v1/leads").status_code == 200
    assert authed_client.get(f"/api/v1/leads/{lead['id']}").status_code == 200
