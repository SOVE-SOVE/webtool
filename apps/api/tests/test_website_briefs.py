WEBSITE_BRIEF_LLM_OUTPUT = {
    "project_summary": "A new website for Riverside Plumbing, a residential plumber in Geelong, built to drive "
    "more phone enquiries from mobile visitors.",
    "goals": ["Generate more phone enquiries from mobile visitors", "Build trust with local credentials"],
    "target_audience": "Homeowners aged 30-60 in Geelong needing urgent or planned plumbing work.",
    "positioning": "The dependable local tradie who answers the phone and shows up — not a faceless national chain.",
    "sitemap_summary": ["Home — Convert a visitor into a phone call.", "Services — List every service offered."],
    "page_purposes": ["Home: Convert a visitor into a phone call.", "Services: List every service offered."],
    "content_requirements": ["Phone number", "Service descriptions"],
    "cta_strategy": "Primary CTA is 'Call now', repeated in header and hero.",
    "visual_direction": "Clean, high-contrast, utilitarian — favor clarity over decoration.",
    "functionality": ["Contact form with email notification"],
    "seo_considerations": ["Target 'emergency plumber Geelong' and similar local-intent search terms."],
    "technical_requirements": ["Mobile-first responsive layout", "Fast load time on 4G"],
}


def _patch_website_brief_agent(monkeypatch, output=None):
    monkeypatch.setattr(
        "app.agents.website_brief.generate_structured",
        lambda **kwargs: dict(output or WEBSITE_BRIEF_LLM_OUTPUT),
    )


def _create_project_without_lead(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post(
        "/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}
    ).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}
    ).json()
    return project


def test_generate_website_brief_requires_auth(client):
    res = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/website-briefs")
    assert res.status_code == 401


def test_generate_website_brief_unknown_project_404s(authed_client, monkeypatch):
    _patch_website_brief_agent(monkeypatch)
    res = authed_client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/website-briefs")
    assert res.status_code == 404


def test_generate_website_brief_with_nothing_on_record_flags_for_review(authed_client, monkeypatch):
    _patch_website_brief_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)

    res = authed_client.post(f"/api/v1/projects/{project['id']}/website-briefs")
    assert res.status_code == 201
    body = res.json()

    assert body["status"] == "draft"
    assert body["project_id"] == project["id"]
    assert body["project_summary"] == WEBSITE_BRIEF_LLM_OUTPUT["project_summary"]
    # Nothing confirmed by the client yet — no intake brief was filled in.
    assert body["confirmed_requirements"] == []
    # Everything is an AI suggestion at this point, including target
    # audience/CTA/visual direction/sitemap, since no upstream artifact exists.
    assert any("Target audience" in s for s in body["ai_suggestions"])
    assert any("CTA strategy" in s for s in body["ai_suggestions"])
    assert any("Sitemap" in s for s in body["ai_suggestions"])
    assert body["target_audience"] == WEBSITE_BRIEF_LLM_OUTPUT["target_audience"]
    assert body["cta_strategy"] == WEBSITE_BRIEF_LLM_OUTPUT["cta_strategy"]
    assert body["flagged_for_review"] is True
    assert body["review_notes"] is not None

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "website_brief_generated" for a in activity)


def test_generate_website_brief_prefers_real_upstream_data_over_llm_draft(authed_client, monkeypatch):
    _patch_website_brief_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)

    brief_res = authed_client.patch(
        f"/api/v1/projects/{project['id']}/brief",
        json={
            "target_customers": "Homeowners in Geelong needing urgent plumbing work",
            "business_goals": "More phone enquiries",
            "business_description": "A residential plumbing business.",
        },
    )
    assert brief_res.status_code == 200

    creative_direction_output = {
        "facts": ["Riverside Plumbing is a residential plumbing business in Geelong, VIC."],
        "assumptions": [],
        "creative_concept": "A dependable, no-nonsense local tradie brand.",
        "visual_direction": "Clean, high-contrast, utilitarian.",
        "brand_personality": ["Trustworthy"],
        "colour_direction": "Deep blue with an amber accent.",
        "typography_direction": "A confident, legible sans-serif.",
        "image_direction": "Real photos of the crew.",
        "layout_direction": "Short, scannable homepage.",
        "ux_direction": "One-tap call button.",
        "tone_of_voice": "Plain-spoken, direct.",
        "visual_hierarchy": "Phone number first.",
        "cta_strategy": "REAL CTA: Call now, repeated throughout — from the approved creative direction.",
        "things_to_avoid": ["Generic stock photos"],
        "references_inspiration": ["Local trade-service sites"],
    }
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(creative_direction_output)
    )
    cd = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()
    authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")

    sitemap_output = {
        "overview": "A compact site.",
        "pages": [
            {
                "title": "Home",
                "slug": "home",
                "page_type": "home",
                "parent_slug": None,
                "nav_placement": "primary_nav",
                "purpose": "REAL PURPOSE: convert a visitor into a phone call — from the approved sitemap.",
                "primary_cta": "Call now",
                "secondary_cta": None,
                "key_sections": ["Hero"],
                "required_content": ["Phone number"],
                "required_functionality": ["Click-to-call button"],
            }
        ],
    }
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(sitemap_output))
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")

    res = authed_client.post(f"/api/v1/projects/{project['id']}/website-briefs")
    assert res.status_code == 201
    body = res.json()

    # Real, already-reviewed content wins over a fresh LLM guess.
    assert body["target_audience"] == "Homeowners in Geelong needing urgent plumbing work"
    assert "REAL CTA" in body["cta_strategy"]
    assert any("REAL PURPOSE" in line for line in body["sitemap_summary"])
    assert any("Phone number" in line for line in body["content_requirements"])
    assert "Click-to-call button" in body["functionality"]
    # Genuinely new sections (no other source) still come from the agent.
    assert body["positioning"] == WEBSITE_BRIEF_LLM_OUTPUT["positioning"]
    assert body["seo_considerations"] == WEBSITE_BRIEF_LLM_OUTPUT["seo_considerations"]

    # Client-confirmed facts are surfaced separately from AI suggestions.
    assert any("Homeowners in Geelong" in c for c in body["confirmed_requirements"])
    assert not any("Target audience" in s for s in body["ai_suggestions"])
    assert not any("CTA strategy" in s for s in body["ai_suggestions"])
    assert not any("Sitemap" in s for s in body["ai_suggestions"])
    assert any("Positioning" in s for s in body["ai_suggestions"])
    assert body["creative_direction_id"] == cd["id"]
    assert body["sitemap_id"] == sitemap["id"]
    assert body["flagged_for_review"] is False


def test_update_website_brief_edits_fields(authed_client, monkeypatch):
    _patch_website_brief_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    brief = authed_client.post(f"/api/v1/projects/{project['id']}/website-briefs").json()

    res = authed_client.patch(
        f"/api/v1/website-briefs/{brief['id']}",
        json={
            "positioning": "Operator-revised positioning.",
            "seo_considerations": ["Target 'plumber near me' searches"],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["positioning"] == "Operator-revised positioning."
    assert body["seo_considerations"] == ["Target 'plumber near me' searches"]
    # Untouched fields survive the partial edit.
    assert body["project_summary"] == WEBSITE_BRIEF_LLM_OUTPUT["project_summary"]
    assert body["edited_by_user_name"] == "Ada Admin"
    assert body["edited_at"] is not None

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "website_brief_edited" for a in activity)


def test_approve_website_brief(authed_client, monkeypatch):
    _patch_website_brief_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    brief = authed_client.post(f"/api/v1/projects/{project['id']}/website-briefs").json()
    assert brief["status"] == "draft"

    res = authed_client.post(f"/api/v1/website-briefs/{brief['id']}/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "approved"
    assert body["approved_by_user_name"] == "Ada Admin"
    assert body["approved_at"] is not None

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "website_brief_approved" for a in activity)


def test_editing_an_approved_website_brief_reverts_it_to_draft(authed_client, monkeypatch):
    _patch_website_brief_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    brief = authed_client.post(f"/api/v1/projects/{project['id']}/website-briefs").json()
    authed_client.post(f"/api/v1/website-briefs/{brief['id']}/approve")

    res = authed_client.patch(
        f"/api/v1/website-briefs/{brief['id']}", json={"positioning": "A revised positioning"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "draft"
    assert body["approved_by_user_name"] is None
    assert body["approved_at"] is None


def test_list_website_briefs(authed_client, monkeypatch):
    _patch_website_brief_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    authed_client.post(f"/api/v1/projects/{project['id']}/website-briefs")
    authed_client.post(f"/api/v1/projects/{project['id']}/website-briefs")

    res = authed_client.get(f"/api/v1/projects/{project['id']}/website-briefs")
    assert res.status_code == 200
    assert len(res.json()) == 2


def test_website_briefs_are_workspace_isolated(authed_client, other_authed_client, monkeypatch):
    _patch_website_brief_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    brief = authed_client.post(f"/api/v1/projects/{project['id']}/website-briefs").json()

    res = other_authed_client.get(f"/api/v1/website-briefs/{brief['id']}")
    assert res.status_code == 404
