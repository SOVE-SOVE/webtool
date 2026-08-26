SITEMAP_LLM_OUTPUT = {
    "overview": "A compact site for a residential plumber.",
    "pages": [
        {
            "title": "Home",
            "slug": "",
            "page_type": "home",
            "parent_slug": None,
            "nav_placement": "primary_nav",
            "purpose": "Convert a visitor into a phone call or quote request.",
            "primary_cta": "Get a quote",
            "secondary_cta": None,
            "key_sections": ["Hero", "Services overview"],
            "required_content": [],
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
            "required_content": [],
            "required_functionality": [],
        },
    ],
}

_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "services_content": "Blocked drains\nHot water systems\nLeak detection",
    "contact_email": "hello@riversideplumbing.com.au",
    "contact_phone": "0412 345 678",
}


def _patch_sitemap_agent(monkeypatch, output=None):
    monkeypatch.setattr(
        "app.agents.sitemap.generate_structured",
        lambda **kwargs: dict(output or SITEMAP_LLM_OUTPUT),
    )


def _patch_content_generator(monkeypatch, pages, missing_information=None):
    monkeypatch.setattr(
        "app.agents.content_generator.generate_structured",
        lambda **kwargs: {"pages": pages, "missing_information": missing_information or []},
    )


def _create_project_without_lead(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post(
        "/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}
    ).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}
    ).json()
    return project


def _set_brief(authed_client, project_id, **fields):
    res = authed_client.patch(f"/api/v1/projects/{project_id}/brief", json=fields)
    assert res.status_code == 200
    return res.json()


def _create_project_with_sitemap(authed_client, monkeypatch, brief_fields=None):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    _set_brief(authed_client, project["id"], **(brief_fields or _REAL_BRIEF))
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    return project, sitemap


def _home_page_id(sitemap):
    return next(p["id"] for p in sitemap["pages"] if p["page_type"] == "home")


def _drafted_pages(sitemap, **overrides):
    home_id = _home_page_id(sitemap)
    services_id = next(p["id"] for p in sitemap["pages"] if p["page_type"] == "services")
    page = {
        "page_id": home_id,
        "seo_title": "Riverside Plumbing — Licensed Plumbers in Ipswich",
        "meta_description": "Licensed local plumbers in Ipswich handling blocked drains, hot water, and leaks.",
        "hero_heading": "Ipswich plumbing, done right the first time",
        "hero_subheading": "Riverside Plumbing has served Ipswich homes since 2011.",
        "body": None,
        "services": [],
        "faqs": [],
        "cta_heading": "Need a plumber today?",
        "cta_body": "Get a quote from Riverside Plumbing.",
    }
    page.update(overrides)
    services_page = {
        "page_id": services_id,
        "seo_title": "Services — Riverside Plumbing",
        "meta_description": None,
        "hero_heading": "What we do",
        "hero_subheading": None,
        "body": None,
        "services": [
            {"title": "Blocked drains", "description": "Fast diagnosis and clearing of blocked drains in Ipswich homes."},
            {"title": "Hot water systems", "description": "Repair and replacement of residential hot water systems."},
            {"title": "Leak detection", "description": "Locating and fixing leaks before they cause real damage."},
        ],
        "faqs": [],
        "cta_heading": None,
        "cta_body": None,
    }
    return [page, services_page]


def test_generate_content_draft_requires_auth(client):
    res = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/content-drafts")
    assert res.status_code == 401


def test_generate_content_draft_unknown_project_404s(authed_client, monkeypatch):
    _patch_content_generator(monkeypatch, [])
    res = authed_client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/content-drafts")
    assert res.status_code == 404


def test_generate_content_draft_without_sitemap_400s(authed_client):
    project = _create_project_without_lead(authed_client)
    res = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts")
    assert res.status_code == 400


def test_generate_content_draft_happy_path(authed_client, monkeypatch):
    project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch)
    _patch_content_generator(monkeypatch, _drafted_pages(sitemap))

    res = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts", json={"tone": "friendly"})
    assert res.status_code == 201
    body = res.json()

    assert body["status"] == "draft"
    assert body["project_id"] == project["id"]
    assert body["tone"] == "friendly"
    assert len(body["pages"]) == 2
    home = next(p for p in body["pages"] if p["page_id"] == _home_page_id(sitemap))
    assert home["hero_heading"] == "Ipswich plumbing, done right the first time"
    assert home["page_title"] == "Home"
    services = next(p for p in body["pages"] if p["page_id"] != _home_page_id(sitemap))
    assert len(services["services"]) == 3
    assert services["services"][0]["title"] == "Blocked drains"

    list_res = authed_client.get(f"/api/v1/projects/{project['id']}/content-drafts")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1
    assert list_res.json()[0]["tone"] == "friendly"

    get_res = authed_client.get(f"/api/v1/content-drafts/{body['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == body["id"]

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "content_draft_generated" for a in activity)


def test_generate_content_draft_reports_missing_information(authed_client, monkeypatch):
    project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch, brief_fields={})
    _patch_content_generator(
        monkeypatch,
        _drafted_pages(sitemap, hero_heading="Riverside Plumbing", hero_subheading=None),
        missing_information=["No business description on file — hero subheading could not be drafted."],
    )

    res = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts")
    assert res.status_code == 201
    body = res.json()
    assert body["flagged_for_review"] is True
    assert "hero subheading could not be drafted" in body["missing_information"][0]


def test_update_content_draft_page_edits_content_and_reverts_approval(authed_client, monkeypatch):
    project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch)
    _patch_content_generator(monkeypatch, _drafted_pages(sitemap))
    draft = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()
    authed_client.post(f"/api/v1/content-drafts/{draft['id']}/approve")

    home_id = _home_page_id(sitemap)
    res = authed_client.patch(
        f"/api/v1/content-drafts/{draft['id']}/pages/{home_id}",
        json={"hero_heading": "Operator-edited heading", "cta_heading": "Call us now"},
    )
    assert res.status_code == 200
    body = res.json()
    home = next(p for p in body["pages"] if p["page_id"] == home_id)
    assert home["hero_heading"] == "Operator-edited heading"
    assert home["cta_heading"] == "Call us now"
    # Untouched fields survive the partial edit.
    assert home["seo_title"] == "Riverside Plumbing — Licensed Plumbers in Ipswich"
    # Editing content after approval reverts it — same contract as every
    # other approval checkpoint in this app.
    assert body["status"] == "draft"

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(
        a["action"] == "content_draft_page_updated" and "reverted to draft" in a["summary"] for a in activity
    )


def test_update_content_draft_unknown_page_404s(authed_client, monkeypatch):
    project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch)
    _patch_content_generator(monkeypatch, _drafted_pages(sitemap))
    draft = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()

    res = authed_client.patch(
        f"/api/v1/content-drafts/{draft['id']}/pages/not-a-real-page-id", json={"hero_heading": "x"}
    )
    assert res.status_code == 404


def test_approve_content_draft(authed_client, monkeypatch):
    project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch)
    _patch_content_generator(monkeypatch, _drafted_pages(sitemap))
    draft = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()
    assert draft["status"] == "draft"

    res = authed_client.post(f"/api/v1/content-drafts/{draft['id']}/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "approved"
    assert body["approved_by_user_name"] == "Ada Admin"
    assert body["approved_at"] is not None

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "content_draft_approved" for a in activity)


def test_rollback_content_draft_creates_new_version_with_old_content(authed_client, monkeypatch):
    project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch)
    home_id = _home_page_id(sitemap)

    _patch_content_generator(monkeypatch, _drafted_pages(sitemap, hero_heading="Version one heading"))
    v1 = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()
    authed_client.post(f"/api/v1/content-drafts/{v1['id']}/approve")

    _patch_content_generator(monkeypatch, _drafted_pages(sitemap, hero_heading="Version two heading"))
    v2 = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()
    v2_home = next(p for p in v2["pages"] if p["page_id"] == home_id)
    assert v2_home["hero_heading"] == "Version two heading"

    res = authed_client.post(f"/api/v1/content-drafts/{v1['id']}/rollback")
    assert res.status_code == 201
    restored = res.json()
    assert restored["id"] != v1["id"]
    assert restored["id"] != v2["id"]
    assert restored["status"] == "draft"
    restored_home = next(p for p in restored["pages"] if p["page_id"] == home_id)
    assert restored_home["hero_heading"] == "Version one heading"

    versions = authed_client.get(f"/api/v1/projects/{project['id']}/content-drafts").json()
    assert len(versions) == 3
    assert versions[0]["id"] == restored["id"]

    activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
    assert any(a["action"] == "content_draft_rolled_back" for a in activity)
