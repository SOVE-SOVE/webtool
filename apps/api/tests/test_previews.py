from datetime import datetime, timedelta, timezone

_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "contact_email": "hello@riversideplumbing.com.au",
}

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


def _patch_sitemap_agent(monkeypatch):
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(SITEMAP_LLM_OUTPUT))


def _patch_creative_director(monkeypatch):
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )


def _create_project_without_lead(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post("/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}).json()
    return authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}).json()


def _build_project_with_approved_website(authed_client, monkeypatch):
    """A project whose latest website version has cleared checkpoint 4
    (operator's own sign-off) — the bar CLIENT-audience preview
    visibility is gated on."""
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
    return project, website


class TestCreatePreviewLink:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/previews")
        assert res.status_code == 401

    def test_unknown_project_404s(self, authed_client):
        res = authed_client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/previews")
        assert res.status_code == 404

    def test_defaults_to_client_audience_and_returns_a_usable_url(self, authed_client):
        project = _create_project_without_lead(authed_client)
        res = authed_client.post(f"/api/v1/projects/{project['id']}/previews")
        assert res.status_code == 201
        body = res.json()
        assert body["audience"] == "client"
        assert body["url"] is not None and "/preview/" in body["url"]
        assert body["active"] is True
        assert body["revoked"] is False
        assert body["expired"] is False
        assert body["access_count"] == 0

    def test_internal_audience_and_custom_label(self, authed_client):
        project = _create_project_without_lead(authed_client)
        res = authed_client.post(
            f"/api/v1/projects/{project['id']}/previews",
            json={"audience": "internal", "label": "For the design team"},
        )
        assert res.status_code == 201
        body = res.json()
        assert body["audience"] == "internal"

    def test_no_expiry_when_expires_in_days_is_null(self, authed_client):
        project = _create_project_without_lead(authed_client)
        res = authed_client.post(f"/api/v1/projects/{project['id']}/previews", json={"expires_in_days": None})
        assert res.status_code == 201
        assert res.json()["expires_at"] is None


class TestListAndRevokePreviewLinks:
    def test_list_never_re_exposes_the_raw_token(self, authed_client):
        project = _create_project_without_lead(authed_client)
        authed_client.post(f"/api/v1/projects/{project['id']}/previews")

        res = authed_client.get(f"/api/v1/projects/{project['id']}/previews")
        assert res.status_code == 200
        links = res.json()
        assert len(links) == 1
        assert links[0]["url"] is None
        assert len(links[0]["token_suffix"]) == 6

    def test_revoke_happy_path(self, authed_client):
        project = _create_project_without_lead(authed_client)
        created = authed_client.post(f"/api/v1/projects/{project['id']}/previews").json()

        res = authed_client.post(f"/api/v1/previews/{created['id']}/revoke")
        assert res.status_code == 200
        body = res.json()
        assert body["revoked"] is True
        assert body["active"] is False

    def test_revoke_unknown_404s(self, authed_client):
        res = authed_client.post("/api/v1/previews/00000000-0000-0000-0000-000000000000/revoke")
        assert res.status_code == 404

    def test_workspace_isolated(self, authed_client, other_authed_client):
        project = _create_project_without_lead(authed_client)
        created = authed_client.post(f"/api/v1/projects/{project['id']}/previews").json()

        assert other_authed_client.get(f"/api/v1/projects/{project['id']}/previews").status_code == 404
        assert other_authed_client.post(f"/api/v1/previews/{created['id']}/revoke").status_code == 404


class TestPublicPreviewResolution:
    def test_unknown_token_404s(self, client):
        res = client.get("/api/v1/preview/not-a-real-token")
        assert res.status_code == 404

    def test_revoked_link_returns_410(self, authed_client, client):
        project = _create_project_without_lead(authed_client)
        created = authed_client.post(f"/api/v1/projects/{project['id']}/previews").json()
        token = created["url"].rsplit("/", 1)[-1]
        authed_client.post(f"/api/v1/previews/{created['id']}/revoke")

        assert client.get(f"/api/v1/preview/{token}").status_code == 410

    def test_expired_link_returns_410(self, authed_client, client, db_session):
        from app.modules.previews.models import PreviewLink

        project = _create_project_without_lead(authed_client)
        created = authed_client.post(f"/api/v1/projects/{project['id']}/previews").json()
        token = created["url"].rsplit("/", 1)[-1]

        link = db_session.query(PreviewLink).filter(PreviewLink.id == created["id"]).one()
        link.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        db_session.commit()

        assert client.get(f"/api/v1/preview/{token}").status_code == 410

    def test_client_link_404s_until_a_version_is_operator_approved(self, authed_client, client, monkeypatch):
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
        authed_client.post(f"/api/v1/projects/{project_id}/websites")  # generated, never approved

        created = authed_client.post(f"/api/v1/projects/{project_id}/previews").json()
        token = created["url"].rsplit("/", 1)[-1]

        res = client.get(f"/api/v1/preview/{token}")
        assert res.status_code == 404

    def test_client_link_renders_the_approved_version(self, authed_client, client, monkeypatch):
        project, website = _build_project_with_approved_website(authed_client, monkeypatch)
        created = authed_client.post(f"/api/v1/projects/{project['id']}/previews").json()
        token = created["url"].rsplit("/", 1)[-1]

        res = client.get(f"/api/v1/preview/{token}")
        assert res.status_code == 200
        body = res.json()
        assert body["website_id"] == website["id"]
        assert body["audience"] == "client"
        assert body["navigation"]["type"] == "navigation"
        assert len(body["pages"]) >= 1
        assert len(body["versions"]) == 1

    def test_internal_link_can_see_an_unapproved_draft(self, authed_client, client, monkeypatch):
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

        created = authed_client.post(
            f"/api/v1/projects/{project_id}/previews", json={"audience": "internal"}
        ).json()
        token = created["url"].rsplit("/", 1)[-1]

        res = client.get(f"/api/v1/preview/{token}")
        assert res.status_code == 200
        assert res.json()["website_id"] == website["id"]

    def test_version_selection_only_exposes_visible_versions_and_default_falls_back_to_the_latest_visible_one(
        self, authed_client, client, monkeypatch
    ):
        project, v1 = _build_project_with_approved_website(authed_client, monkeypatch)
        # A second, never-approved version — regeneration always creates
        # a new row (see modules/websites/service.py).
        v2 = authed_client.post(
            f"/api/v1/projects/{project['id']}/websites", json={"force_regenerate_all": True}
        ).json()
        assert v2["id"] != v1["id"]

        created = authed_client.post(f"/api/v1/projects/{project['id']}/previews").json()
        token = created["url"].rsplit("/", 1)[-1]

        default_res = client.get(f"/api/v1/preview/{token}")
        assert default_res.status_code == 200
        assert default_res.json()["website_id"] == v1["id"]

        assert client.get(f"/api/v1/preview/{token}/versions/{v1['id']}").status_code == 200
        assert client.get(f"/api/v1/preview/{token}/versions/{v2['id']}").status_code == 404

    def test_access_is_tracked(self, authed_client, client, monkeypatch):
        project, _ = _build_project_with_approved_website(authed_client, monkeypatch)
        created = authed_client.post(f"/api/v1/projects/{project['id']}/previews").json()
        token = created["url"].rsplit("/", 1)[-1]

        client.get(f"/api/v1/preview/{token}")
        client.get(f"/api/v1/preview/{token}")

        links = authed_client.get(f"/api/v1/projects/{project['id']}/previews").json()
        assert links[0]["access_count"] == 2
        assert links[0]["last_accessed_at"] is not None
