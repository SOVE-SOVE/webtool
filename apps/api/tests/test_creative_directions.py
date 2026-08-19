from app.integrations.browser import PageSignals

SALES_AUDIT_LLM_OUTPUT = {
    "business_summary": "Riverside Plumbing is a residential plumbing business in Geelong, VIC.",
    "website_strengths": ["Uses HTTPS"],
    "top_problems": ["No mobile viewport meta tag"],
    "why_problems_matter": ["Visitors on phones may see a broken layout"],
    "recommended_improvements": ["Add a responsive layout"],
    "suggested_structure": ["Home", "Services", "About", "Contact"],
    "talking_points": ["Your site isn't mobile-friendly."],
    "potential_objections": ["\"My current site is fine\" — it loads, but has layout issues."],
    "suggested_offer": "Core tier (~$899) fits a small trade-business rebuild.",
}

CREATIVE_DIRECTION_LLM_OUTPUT = {
    "facts": [
        "Riverside Plumbing is a residential plumbing business in Geelong, VIC.",
        "The existing site has no mobile viewport meta tag (measured).",
    ],
    "assumptions": ["None — target audience and business goals were both supplied."],
    "creative_concept": "A dependable, no-nonsense local tradie brand that reads as fast and trustworthy on a phone.",
    "visual_direction": "Clean, high-contrast, utilitarian — favor clarity over decoration.",
    "brand_personality": ["Trustworthy", "Prompt", "No-nonsense"],
    "colour_direction": "A deep blue primary with a warm amber accent for CTAs, echoing trade-industry trust cues.",
    "typography_direction": "A confident, highly legible sans-serif for both headings and body.",
    "image_direction": "Real photos of the crew and completed jobs in Geelong, not stock plumbing photos.",
    "layout_direction": "Short, scannable homepage: hero, services grid, service area, contact.",
    "ux_direction": "One-tap call button pinned on mobile; quote-request form never more than one tap away.",
    "tone_of_voice": "Plain-spoken, direct, no jargon — talk like a tradie talking to a neighbour.",
    "visual_hierarchy": "Phone number and 'Get a quote' first, service list second, trust signals third.",
    "cta_strategy": "Primary CTA is 'Call now' (click-to-call), repeated in header and hero; secondary is a quote form.",
    "things_to_avoid": ["Generic corporate stock photos", "Overly playful color palette"],
    "references_inspiration": ["Local trade-service sites with a strong mobile call-to-action pattern"],
}


def _patch_creative_director(monkeypatch, output=None):
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured",
        lambda **kwargs: dict(output or CREATIVE_DIRECTION_LLM_OUTPUT),
    )


def _patch_sales_audit_happy_path(monkeypatch):
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
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(SALES_AUDIT_LLM_OUTPUT))
    monkeypatch.setattr("app.integrations.search.search_business", lambda query: None)


def _create_lead(authed_client, **overrides):
    payload = {"business_name": "Riverside Plumbing", "suburb": "Geelong", "state": "VIC"}
    payload.update(overrides)
    return authed_client.post("/api/v1/leads", json=payload).json()


def _create_project_from_lead(authed_client, monkeypatch, generate_sales_audit=True):
    """A project whose client came from a won lead — real website audit +
    sales audit on record for the creative direction agent to draw on."""
    lead = _create_lead(authed_client)
    if generate_sales_audit:
        _patch_sales_audit_happy_path(monkeypatch)
        authed_client.patch(
            f"/api/v1/businesses/{lead['business_id']}",
            json={"website_url": "https://riversideplumbing.example"},
        )
        res = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
        assert res.status_code == 201

    client = authed_client.post("/api/v1/clients", json={"from_lead_id": lead["id"]}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client["id"], "name": "Riverside Plumbing website"}
    ).json()
    return project


def _create_project_without_lead(authed_client):
    """A project for a client added directly (never went through the lead
    pipeline) — no business.lead at all, so no audit/sales-audit exists."""
    client = authed_client.post(
        "/api/v1/clients", json={"business_name": "Coastal Cafe", "industry": "Cafe"}
    ).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client["id"], "name": "Coastal Cafe website"}
    ).json()
    return project


def test_generate_creative_direction_requires_auth(client):
    res = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/creative-directions")
    assert res.status_code == 401


def test_generate_creative_direction_unknown_project_404s(authed_client, monkeypatch):
    _patch_creative_director(monkeypatch)
    res = authed_client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/creative-directions")
    assert res.status_code == 404


def test_generate_creative_direction_happy_path(authed_client, monkeypatch):
    _patch_creative_director(monkeypatch)
    project = _create_project_from_lead(authed_client, monkeypatch)

    res = authed_client.post(
        f"/api/v1/projects/{project['id']}/creative-directions",
        json={
            "target_audience": "Homeowners aged 30-60 in Geelong needing urgent or planned plumbing work",
            "business_goals": "Generate more phone enquiries from mobile visitors",
        },
    )
    assert res.status_code == 201
    body = res.json()

    assert body["status"] == "draft"
    assert body["project_id"] == project["id"]
    assert body["creative_concept"] == CREATIVE_DIRECTION_LLM_OUTPUT["creative_concept"]
    assert body["brand_personality"] == CREATIVE_DIRECTION_LLM_OUTPUT["brand_personality"]
    assert body["things_to_avoid"] == CREATIVE_DIRECTION_LLM_OUTPUT["things_to_avoid"]
    assert body["facts"] == CREATIVE_DIRECTION_LLM_OUTPUT["facts"]
    # Both target audience and business goals were supplied — not thin
    # evidence, so this should not be flagged.
    assert body["flagged_for_review"] is False
    assert "riversideplumbing" in body["sources_note"] or "Business record" in body["sources_note"]
    assert "operator-supplied" in body["sources_note"]

    list_res = authed_client.get(f"/api/v1/projects/{project['id']}/creative-directions")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    get_res = authed_client.get(f"/api/v1/creative-directions/{body['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == body["id"]

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "creative_direction_generated" for a in activity)


def test_generate_creative_direction_without_client_context_flags_for_review(authed_client, monkeypatch):
    _patch_creative_director(monkeypatch)
    project = _create_project_without_lead(authed_client)

    res = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions")
    assert res.status_code == 201
    body = res.json()

    # No target audience, no business goals, no lead/audit/sales-research
    # at all — genuinely thin evidence, must be flagged rather than pass
    # through silently (docs/03_AGENT_RULES.md).
    assert body["flagged_for_review"] is True
    assert body["review_notes"] is not None
    assert "not supplied" in body["sources_note"]
    assert "no linked lead on record" in body["sources_note"]


def test_update_creative_direction_edits_fields(authed_client, monkeypatch):
    _patch_creative_director(monkeypatch)
    project = _create_project_without_lead(authed_client)
    brief = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()

    res = authed_client.patch(
        f"/api/v1/creative-directions/{brief['id']}",
        json={
            "creative_concept": "Operator-revised concept: warm, family-run cafe feel.",
            "things_to_avoid": ["Cold corporate imagery", "Overly formal tone"],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["creative_concept"] == "Operator-revised concept: warm, family-run cafe feel."
    assert body["things_to_avoid"] == ["Cold corporate imagery", "Overly formal tone"]
    # Untouched fields survive the partial edit.
    assert body["visual_direction"] == CREATIVE_DIRECTION_LLM_OUTPUT["visual_direction"]
    assert body["edited_by_user_name"] == "Ada Admin"
    assert body["edited_at"] is not None

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "creative_direction_edited" for a in activity)


def test_approve_creative_direction(authed_client, monkeypatch):
    _patch_creative_director(monkeypatch)
    project = _create_project_without_lead(authed_client)
    brief = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()
    assert brief["status"] == "draft"

    res = authed_client.post(f"/api/v1/creative-directions/{brief['id']}/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "approved"
    assert body["approved_by_user_name"] == "Ada Admin"
    assert body["approved_at"] is not None

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "creative_direction_approved" for a in activity)


def test_creative_directions_are_workspace_isolated(authed_client, other_authed_client, monkeypatch):
    _patch_creative_director(monkeypatch)
    project = _create_project_without_lead(authed_client)
    brief = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()

    assert other_authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").status_code == 404
    assert other_authed_client.get(f"/api/v1/projects/{project['id']}/creative-directions").status_code == 404
    assert other_authed_client.get(f"/api/v1/creative-directions/{brief['id']}").status_code == 404
    assert (
        other_authed_client.patch(
            f"/api/v1/creative-directions/{brief['id']}", json={"creative_concept": "hijacked"}
        ).status_code
        == 404
    )
    assert other_authed_client.post(f"/api/v1/creative-directions/{brief['id']}/approve").status_code == 404
