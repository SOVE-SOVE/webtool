from app.integrations.browser import PageSignals
from app.integrations.search import SearchResult

FAKE_LLM_OUTPUT = {
    "business_summary": "Riverside Plumbing is a residential plumbing business in Geelong, VIC.",
    "website_strengths": ["Uses HTTPS", "Clear business name in the page title"],
    "top_problems": ["No mobile viewport meta tag", "No online booking/contact form found"],
    "why_problems_matter": [
        "Visitors on phones may see a broken layout",
        "Enquiries likely have to go through phone only",
    ],
    "recommended_improvements": ["Add a responsive layout", "Add a contact form"],
    "suggested_structure": ["Home", "Services", "About", "Contact"],
    "talking_points": ["Your site isn't showing a mobile-friendly viewport tag on the homepage."],
    "potential_objections": ["\"My current site is fine\" — it loads, but the mobile layout has issues."],
    "suggested_offer": "Core tier (~$899) fits a small trade-business rebuild with a handful of pages.",
}


def _patch_happy_path(monkeypatch):
    async def fake_fetch(url):
        return PageSignals(
            final_url=url,
            https=True,
            http_status=200,
            title="Riverside Plumbing",
            meta_description="Local plumbing services",
            viewport_meta_present=False,
            mobile_overflow=True,
            load_time_ms=850,
        )

    monkeypatch.setattr("app.agents.website_audit.fetch_page_signals", fake_fetch)
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(FAKE_LLM_OUTPUT))
    monkeypatch.setattr(
        "app.integrations.search.search_business",
        lambda query: [SearchResult(title="Riverside Plumbing", url="https://example.com", description="Plumber in Geelong")],
    )


def _create_lead(authed_client, **overrides):
    payload = {"business_name": "Riverside Plumbing", "suburb": "Geelong", "state": "VIC"}
    payload.update(overrides)
    return authed_client.post("/api/v1/leads", json=payload).json()


def test_generate_sales_audit_requires_auth(client):
    res = client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/sales-audits")
    assert res.status_code == 401


def test_generate_sales_audit_unknown_lead_404s(authed_client):
    res = authed_client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/sales-audits")
    assert res.status_code == 404


def test_generate_sales_audit_happy_path(authed_client, monkeypatch):
    _patch_happy_path(monkeypatch)
    lead = _create_lead(authed_client)
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"score": 70})
    authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"website_url": "https://riversideplumbing.example"})

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    assert res.status_code == 201
    body = res.json()
    assert body["business_summary"] == FAKE_LLM_OUTPUT["business_summary"]
    assert body["top_problems"] == FAKE_LLM_OUTPUT["top_problems"]
    assert body["why_problems_matter"] == FAKE_LLM_OUTPUT["why_problems_matter"]
    assert body["suggested_offer"] == FAKE_LLM_OUTPUT["suggested_offer"]
    assert body["flagged_for_review"] is False
    assert body["website_audit"]["has_existing_site"] is True
    assert body["website_audit"]["load_time_ms"] == 850
    assert "riversideplumbing.example" in body["sources_note"]

    # Lead score is recomputed from the fresh audit (not mobile-friendly:
    # viewport tag missing and content overflows at mobile width), not
    # left at the score=70 patched in above.
    assert "Lead score: 55 (Not mobile-friendly)" in body["sources_note"]
    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["score"] == 55

    list_res = authed_client.get(f"/api/v1/leads/{lead['id']}/sales-audits")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    get_res = authed_client.get(f"/api/v1/sales-audits/{body['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == body["id"]

    activity = authed_client.get(
        f"/api/v1/activity?entity_type=lead&entity_id={lead['id']}"
    ).json()
    assert any(a["action"] == "sales_audit_generated" for a in activity)
    assert any(a["action"] == "lead_score_computed" and "55/100" in a["summary"] for a in activity)


def test_generate_sales_audit_bumps_a_new_lead_to_researched(authed_client, monkeypatch):
    _patch_happy_path(monkeypatch)
    lead = _create_lead(authed_client)
    assert lead["status"] == "new"

    authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["status"] == "researched"


def test_generate_sales_audit_never_regresses_a_further_along_lead(authed_client, monkeypatch):
    _patch_happy_path(monkeypatch)
    lead = _create_lead(authed_client)
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified"})

    authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["status"] == "qualified"


def test_generate_sales_audit_no_website_skips_audit(authed_client, monkeypatch):
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(FAKE_LLM_OUTPUT))
    monkeypatch.setattr("app.integrations.search.search_business", lambda query: None)

    lead = _create_lead(authed_client)  # no website_url set
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    assert res.status_code == 201
    body = res.json()
    assert body["website_audit"]["has_existing_site"] is False
    assert "none on record" in body["sources_note"]
    assert "not configured" in body["sources_note"]

    # No site at all is a strong-fit signal for the redesign offer —
    # scored high even though nothing about the business itself changed.
    assert "Lead score: 85 (No existing website on record)" in body["sources_note"]
    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["score"] == 85


def test_generate_sales_audit_clean_site_scores_low(authed_client, monkeypatch):
    async def fake_fetch(url):
        return PageSignals(
            final_url=url,
            https=True,
            http_status=200,
            title="Riverside Plumbing — 24/7 Emergency Plumber",
            meta_description="Fast, licensed plumbing services in Geelong, VIC.",
            viewport_meta_present=True,
            mobile_overflow=False,
            load_time_ms=600,
        )

    monkeypatch.setattr("app.agents.website_audit.fetch_page_signals", fake_fetch)
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(FAKE_LLM_OUTPUT))
    monkeypatch.setattr("app.integrations.search.search_business", lambda query: None)

    lead = _create_lead(authed_client)
    authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"website_url": "https://riversideplumbing.example"})

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    assert res.status_code == 201
    body = res.json()
    assert "Lead score: 30" in body["sources_note"]
    assert body["flagged_for_review"] is False
    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["score"] == 30


def test_generate_sales_audit_website_unreachable_flags_for_review(authed_client, monkeypatch):
    async def failing_fetch(url):
        return PageSignals(error="Timeout 15000ms exceeded")

    monkeypatch.setattr("app.agents.website_audit.fetch_page_signals", failing_fetch)
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(FAKE_LLM_OUTPUT))
    monkeypatch.setattr("app.integrations.search.search_business", lambda query: None)

    lead = _create_lead(authed_client)
    authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"website_url": "https://unreachable.example"})

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    assert res.status_code == 201
    body = res.json()
    assert body["website_audit"]["audit_error"] is not None
    assert body["flagged_for_review"] is True

    # A broken/unreachable site is the most acute pain signal — outranks
    # even "no site at all".
    assert "Lead score: 90" in body["sources_note"]
    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["score"] == 90


def test_sales_audits_are_workspace_isolated(authed_client, other_authed_client, monkeypatch):
    _patch_happy_path(monkeypatch)
    lead = _create_lead(authed_client)
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    audit_id = res.json()["id"]

    assert other_authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits").status_code == 404
    assert other_authed_client.get(f"/api/v1/leads/{lead['id']}/sales-audits").status_code == 404
    assert other_authed_client.get(f"/api/v1/sales-audits/{audit_id}").status_code == 404
