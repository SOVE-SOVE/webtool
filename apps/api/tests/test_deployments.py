CREATIVE_DIRECTION_LLM_OUTPUT = {
    "facts": ["Riverside Plumbing is a residential plumbing business."],
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

SITEMAP_LLM_OUTPUT = {
    "overview": "A compact site for a residential plumber.",
    "pages": [
        {
            "title": "Home", "slug": "", "page_type": "home", "parent_slug": None,
            "nav_placement": "primary_nav", "purpose": "Convert a visitor into a phone call.",
            "primary_cta": "Get a quote", "secondary_cta": None,
            "key_sections": ["Hero"], "required_content": [], "required_functionality": [],
        },
    ],
}

_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "contact_email": "hello@riversideplumbing.com.au",
}


def _patch_sitemap_agent(monkeypatch):
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(SITEMAP_LLM_OUTPUT))


def _patch_creative_director(monkeypatch):
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )


def _create_project_without_lead(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post("/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}).json()
    return authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}).json()


def _build_deployable_project(authed_client, monkeypatch):
    """A project with every checkpoint approved through client review —
    one call away from being deployable."""
    _patch_sitemap_agent(monkeypatch)
    _patch_creative_director(monkeypatch)
    project = _create_project_without_lead(authed_client)
    project_id = project["id"]

    authed_client.patch(f"/api/v1/projects/{project_id}/brief", json=_REAL_BRIEF)
    authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")

    cd = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions").json()
    authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")

    sitemap = authed_client.post(f"/api/v1/projects/{project_id}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")

    website = authed_client.post(f"/api/v1/projects/{project_id}/websites").json()
    authed_client.post(f"/api/v1/websites/{website['id']}/approve")

    qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
    authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")

    authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
    return project, website


class TestCreateDeployment:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/deployments")
        assert res.status_code == 401

    def test_unknown_project_404s(self, authed_client):
        res = authed_client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/deployments")
        assert res.status_code == 404

    def test_blocked_on_a_fresh_project_with_no_approvals_at_all(self, authed_client):
        project = _create_project_without_lead(authed_client)
        res = authed_client.post(f"/api/v1/projects/{project['id']}/deployments")
        assert res.status_code == 400
        detail = res.json()["detail"]
        assert "Client brief" in detail
        assert "Client review" in detail

    def test_blocked_when_only_client_review_is_missing(self, authed_client, monkeypatch):
        _patch_sitemap_agent(monkeypatch)
        _patch_creative_director(monkeypatch)
        project = _create_project_without_lead(authed_client)
        project_id = project["id"]
        authed_client.patch(f"/api/v1/projects/{project_id}/brief", json=_REAL_BRIEF)
        authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")
        cd = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions").json()
        authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
        sitemap = authed_client.post(f"/api/v1/projects/{project_id}/sitemaps").json()
        authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
        website = authed_client.post(f"/api/v1/projects/{project_id}/websites").json()
        authed_client.post(f"/api/v1/websites/{website['id']}/approve")
        qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")
        # Client review deliberately skipped.

        res = authed_client.post(f"/api/v1/projects/{project_id}/deployments")
        assert res.status_code == 400
        detail = res.json()["detail"]
        assert "Client review" in detail
        assert "Client brief" not in detail

    def test_happy_path_once_fully_approved(self, authed_client, monkeypatch):
        project, website = _build_deployable_project(authed_client, monkeypatch)

        res = authed_client.post(
            f"/api/v1/projects/{project['id']}/deployments", json={"environment": "production", "notes": "First launch"}
        )
        assert res.status_code == 201
        body = res.json()
        assert body["website_id"] == website["id"]
        assert body["environment"] == "production"
        assert body["status"] == "pending"
        assert body["approved_by_user_name"] == "Ada Admin"
        assert body["notes"] == "First launch"

    def test_never_bypasses_the_gate_even_with_an_explicit_environment(self, authed_client):
        project = _create_project_without_lead(authed_client)
        res = authed_client.post(f"/api/v1/projects/{project['id']}/deployments", json={"environment": "preview"})
        assert res.status_code == 400

    def test_list_deployments(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        authed_client.post(f"/api/v1/projects/{project['id']}/deployments")

        res = authed_client.get(f"/api/v1/projects/{project['id']}/deployments")
        assert res.status_code == 200
        assert len(res.json()) == 1


class TestWorkspaceIsolation:
    def test_deployments_are_workspace_isolated(self, authed_client, other_authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        authed_client.post(f"/api/v1/projects/{project['id']}/deployments")

        assert other_authed_client.post(f"/api/v1/projects/{project['id']}/deployments").status_code == 404
        assert other_authed_client.get(f"/api/v1/projects/{project['id']}/deployments").status_code == 404
