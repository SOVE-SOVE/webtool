SITEMAP_LLM_OUTPUT = {
    "overview": "A compact site for a residential plumber: a homepage that drives phone enquiries, "
    "a services page with an emergency-plumbing detail page since that's their highest-value job type, "
    "and no blog or portfolio — there's no content-marketing goal and no visual work to showcase.",
    "pages": [
        {
            "title": "Home",
            "slug": "home",
            "page_type": "home",
            "parent_slug": None,
            "nav_placement": "primary_nav",
            "purpose": "Convert a visitor into a phone call or quote request within seconds.",
            "primary_cta": "Call now",
            "secondary_cta": "Get a quote",
            "key_sections": ["Hero", "Services overview", "Service area", "Contact"],
            "required_content": ["Phone number", "Service area suburbs"],
            "required_functionality": [],
        },
        {
            "title": "Services",
            "slug": "services",
            "page_type": "services",
            "parent_slug": None,
            "nav_placement": "primary_nav",
            "purpose": "List everything Riverside Plumbing does.",
            "primary_cta": "Get a quote",
            "secondary_cta": None,
            "key_sections": ["Services grid"],
            "required_content": ["Service descriptions"],
            "required_functionality": [],
        },
        {
            "title": "Emergency Plumbing",
            "slug": "emergency-plumbing",
            "page_type": "service_detail",
            "parent_slug": "services",
            "nav_placement": "not_in_nav",
            "purpose": "Convert urgent, high-intent searchers fast.",
            "primary_cta": "Call now",
            "secondary_cta": None,
            "key_sections": ["Hero", "Response time", "Call button"],
            "required_content": ["Average response time"],
            "required_functionality": [],
        },
        {
            "title": "About",
            "slug": "about",
            "page_type": "about",
            "parent_slug": None,
            "nav_placement": "primary_nav",
            "purpose": "Build trust with local credentials.",
            "primary_cta": "Call now",
            "secondary_cta": None,
            "key_sections": ["Story", "Licensing"],
            "required_content": ["Licence number"],
            "required_functionality": [],
        },
        {
            "title": "Contact",
            "slug": "contact",
            "page_type": "contact",
            "parent_slug": None,
            "nav_placement": "primary_nav",
            "purpose": "Every remaining way to reach the business.",
            "primary_cta": "Send message",
            "secondary_cta": "Call now",
            "key_sections": ["Contact form", "Map"],
            "required_content": ["Business hours"],
            "required_functionality": ["Contact form with email notification"],
        },
    ],
}


def _patch_sitemap_agent(monkeypatch, output=None):
    monkeypatch.setattr(
        "app.agents.sitemap.generate_structured",
        lambda **kwargs: dict(output or SITEMAP_LLM_OUTPUT),
    )


def _patch_creative_director(monkeypatch):
    creative_direction_output = {
        "facts": ["Riverside Plumbing is a residential plumbing business in Geelong, VIC."],
        "assumptions": [],
        "creative_concept": "A dependable, no-nonsense local tradie brand.",
        "visual_direction": "Clean, high-contrast, utilitarian.",
        "brand_personality": ["Trustworthy", "Prompt"],
        "colour_direction": "Deep blue with an amber accent.",
        "typography_direction": "A confident, legible sans-serif.",
        "image_direction": "Real photos of the crew and completed jobs.",
        "layout_direction": "Short, scannable homepage.",
        "ux_direction": "One-tap call button pinned on mobile.",
        "tone_of_voice": "Plain-spoken, direct.",
        "visual_hierarchy": "Phone number first, services second.",
        "cta_strategy": "Primary CTA is 'Call now', repeated throughout.",
        "things_to_avoid": ["Generic corporate stock photos"],
        "references_inspiration": ["Local trade-service sites"],
    }
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(creative_direction_output)
    )


def _create_project_without_lead(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post(
        "/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}
    ).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}
    ).json()
    return project


def _find(pages, slug):
    for page in pages:
        if page["slug"] == slug:
            return page
        found = _find(page["children"], slug)
        if found:
            return found
    return None


def _flatten(pages):
    out = []
    for page in pages:
        out.append(page)
        out.extend(_flatten(page["children"]))
    return out


def test_generate_sitemap_requires_auth(client):
    res = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/sitemaps")
    assert res.status_code == 401


def test_generate_sitemap_unknown_project_404s(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    res = authed_client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/sitemaps")
    assert res.status_code == 404


def test_generate_sitemap_happy_path_builds_page_tree(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)

    res = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps")
    assert res.status_code == 201
    body = res.json()

    assert body["status"] == "draft"
    assert body["project_id"] == project["id"]
    assert body["overview"] == SITEMAP_LLM_OUTPUT["overview"]

    flat = _flatten(body["pages"])
    assert len(flat) == 5

    services = _find(body["pages"], "services")
    assert services is not None
    assert len(services["children"]) == 1
    assert services["children"][0]["slug"] == "emergency-plumbing"
    assert services["children"][0]["nav_placement"] == "not_in_nav"
    assert services["children"][0]["page_type"] == "service_detail"

    home = _find(body["pages"], "home")
    assert home["primary_cta"] == "Call now"
    assert home["key_sections"] == ["Hero", "Services overview", "Service area", "Contact"]

    # No brief and no creative direction on record — thin evidence, must
    # be flagged per docs/03_AGENT_RULES.md.
    assert body["flagged_for_review"] is True
    assert "none generated" in body["sources_note"]
    assert "not started" in body["sources_note"]

    list_res = authed_client.get(f"/api/v1/projects/{project['id']}/sitemaps")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    get_res = authed_client.get(f"/api/v1/sitemaps/{body['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == body["id"]

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "sitemap_generated" for a in activity)


def test_generate_sitemap_with_brief_and_creative_direction_not_flagged(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    _patch_creative_director(monkeypatch)
    project = _create_project_without_lead(authed_client)

    brief_res = authed_client.patch(
        f"/api/v1/projects/{project['id']}/brief",
        json={
            "target_customers": "Homeowners in Geelong needing urgent or planned plumbing work",
            "business_goals": "Generate more phone enquiries from mobile visitors",
            "business_description": "A residential plumbing business.",
        },
    )
    assert brief_res.status_code == 200

    cd_res = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions")
    assert cd_res.status_code == 201
    creative_direction_id = cd_res.json()["id"]

    res = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps")
    assert res.status_code == 201
    body = res.json()

    assert body["flagged_for_review"] is False
    assert body["creative_direction_id"] == creative_direction_id
    assert "from client intake brief" not in body["sources_note"]  # sitemap's own sources_note wording


def test_generate_sitemap_dedupes_duplicate_slugs(authed_client, monkeypatch):
    duplicate_output = {
        "overview": "Two pages, same slug from the model — must not collide.",
        "pages": [
            {
                "title": "Home",
                "slug": "home",
                "page_type": "home",
                "parent_slug": None,
                "nav_placement": "primary_nav",
                "purpose": "Landing page.",
                "primary_cta": "Call now",
                "secondary_cta": None,
                "key_sections": [],
                "required_content": [],
                "required_functionality": [],
            },
            {
                "title": "Home (duplicate)",
                "slug": "home",
                "page_type": "custom",
                "parent_slug": None,
                "nav_placement": "not_in_nav",
                "purpose": "Malformed duplicate.",
                "primary_cta": "N/A",
                "secondary_cta": None,
                "key_sections": [],
                "required_content": [],
                "required_functionality": [],
            },
        ],
    }
    _patch_sitemap_agent(monkeypatch, output=duplicate_output)
    project = _create_project_without_lead(authed_client)

    res = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps")
    assert res.status_code == 201
    slugs = [p["slug"] for p in res.json()["pages"]]
    assert slugs == ["home", "home-2"]


def test_add_edit_delete_page(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()

    add_res = authed_client.post(
        f"/api/v1/sitemaps/{sitemap['id']}/pages",
        json={
            "title": "FAQ",
            "slug": "faq",
            "page_type": "faq",
            "purpose": "Answer common questions.",
            "primary_cta": "Call now",
            "key_sections": ["Question list"],
        },
    )
    assert add_res.status_code == 201
    faq = _find(add_res.json()["pages"], "faq")
    assert faq is not None
    assert faq["purpose"] == "Answer common questions."

    # Duplicate slug rejected.
    dup_res = authed_client.post(
        f"/api/v1/sitemaps/{sitemap['id']}/pages",
        json={"title": "FAQ 2", "slug": "faq", "purpose": "x"},
    )
    assert dup_res.status_code == 400

    edit_res = authed_client.patch(
        f"/api/v1/sitemaps/{sitemap['id']}/pages/{faq['id']}",
        json={"title": "Frequently Asked Questions", "primary_cta": "Get a quote"},
    )
    assert edit_res.status_code == 200
    edited = _find(edit_res.json()["pages"], "faq")
    assert edited["title"] == "Frequently Asked Questions"
    assert edited["primary_cta"] == "Get a quote"

    delete_res = authed_client.delete(f"/api/v1/sitemaps/{sitemap['id']}/pages/{faq['id']}")
    assert delete_res.status_code == 200
    assert _find(delete_res.json()["pages"], "faq") is None


def test_delete_page_promotes_children_instead_of_cascading(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()

    services = _find(sitemap["pages"], "services")
    detail = _find(sitemap["pages"], "emergency-plumbing")
    assert detail["parent_page_id"] == services["id"]

    res = authed_client.delete(f"/api/v1/sitemaps/{sitemap['id']}/pages/{services['id']}")
    assert res.status_code == 200
    body = res.json()

    assert _find(body["pages"], "services") is None
    promoted = _find(body["pages"], "emergency-plumbing")
    assert promoted is not None
    assert promoted["parent_page_id"] is None


def test_update_page_rejects_circular_parent(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()

    services = _find(sitemap["pages"], "services")
    detail = _find(sitemap["pages"], "emergency-plumbing")

    res = authed_client.patch(
        f"/api/v1/sitemaps/{sitemap['id']}/pages/{services['id']}",
        json={"parent_page_id": detail["id"]},
    )
    assert res.status_code == 400

    self_res = authed_client.patch(
        f"/api/v1/sitemaps/{sitemap['id']}/pages/{services['id']}",
        json={"parent_page_id": services["id"]},
    )
    assert self_res.status_code == 400


def test_reorder_pages(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()

    top_level = [p for p in sitemap["pages"]]
    home = next(p for p in top_level if p["slug"] == "home")
    about = next(p for p in top_level if p["slug"] == "about")
    assert home["order_index"] < about["order_index"]

    res = authed_client.patch(
        f"/api/v1/sitemaps/{sitemap['id']}/pages/reorder",
        json={
            "items": [
                {"id": home["id"], "order_index": about["order_index"]},
                {"id": about["id"], "order_index": home["order_index"]},
            ]
        },
    )
    assert res.status_code == 200
    body = res.json()
    new_home = _find(body["pages"], "home")
    new_about = _find(body["pages"], "about")
    assert new_about["order_index"] < new_home["order_index"]

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "sitemap_pages_reordered" for a in activity)


def test_reorder_can_reparent_a_page(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()

    about = _find(sitemap["pages"], "about")
    contact = _find(sitemap["pages"], "contact")

    res = authed_client.patch(
        f"/api/v1/sitemaps/{sitemap['id']}/pages/reorder",
        json={"items": [{"id": contact["id"], "order_index": 0, "parent_page_id": about["id"]}]},
    )
    assert res.status_code == 200
    updated_about = _find(res.json()["pages"], "about")
    assert any(c["slug"] == "contact" for c in updated_about["children"])


def test_approve_sitemap(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    assert sitemap["status"] == "draft"

    res = authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "approved"
    assert body["approved_by_user_name"] == "Ada Admin"
    assert body["approved_at"] is not None

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "sitemap_approved" for a in activity)


def test_editing_an_approved_sitemap_reverts_it_to_draft(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")

    res = authed_client.patch(
        f"/api/v1/sitemaps/{sitemap['id']}/pages/{sitemap['pages'][0]['id']}", json={"title": "Updated title"}
    )
    assert res.status_code == 200
    assert res.json()["status"] == "draft"
    assert res.json()["approved_by_user_name"] is None


def test_adding_a_page_to_an_approved_sitemap_reverts_it_to_draft(authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")

    res = authed_client.post(
        f"/api/v1/sitemaps/{sitemap['id']}/pages", json={"title": "New Page", "slug": "new-page", "purpose": "x"}
    )
    assert res.status_code == 201
    assert res.json()["status"] == "draft"


def test_sitemaps_are_workspace_isolated(authed_client, other_authed_client, monkeypatch):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    page = sitemap["pages"][0]

    assert other_authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").status_code == 404
    assert other_authed_client.get(f"/api/v1/projects/{project['id']}/sitemaps").status_code == 404
    assert other_authed_client.get(f"/api/v1/sitemaps/{sitemap['id']}").status_code == 404
    assert other_authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve").status_code == 404
    assert (
        other_authed_client.post(
            f"/api/v1/sitemaps/{sitemap['id']}/pages", json={"title": "x", "slug": "x", "purpose": "x"}
        ).status_code
        == 404
    )
    assert (
        other_authed_client.patch(
            f"/api/v1/sitemaps/{sitemap['id']}/pages/{page['id']}", json={"title": "hijacked"}
        ).status_code
        == 404
    )
    assert other_authed_client.delete(f"/api/v1/sitemaps/{sitemap['id']}/pages/{page['id']}").status_code == 404
