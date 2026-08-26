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


def _build_project_with_approved_website_and_client_link(authed_client, monkeypatch):
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

    link = authed_client.post(f"/api/v1/projects/{project_id}/previews").json()
    token = link["url"].rsplit("/", 1)[-1]
    return project, website, token


class TestSubmitFeedback:
    def test_unknown_token_404s(self, client):
        res = client.post(
            "/api/v1/preview/not-a-real-token/websites/00000000-0000-0000-0000-000000000000/feedback",
            json={"feedback_type": "comment", "message": "Looks great!"},
        )
        assert res.status_code == 404

    def test_happy_path_records_project_version_and_timestamp(self, authed_client, client, monkeypatch):
        project, website, token = _build_project_with_approved_website_and_client_link(authed_client, monkeypatch)

        res = client.post(
            f"/api/v1/preview/{token}/websites/{website['id']}/feedback",
            json={
                "feedback_type": "comment",
                "message": "Can we make the hero heading bigger?",
                "page_slug": "",
                "section_id": None,
                "client_name": "Jamie Client",
                "client_email": "jamie@example.com",
            },
        )
        assert res.status_code == 201
        body = res.json()
        assert body["project_id"] == project["id"]
        assert body["website_id"] == website["id"]
        assert body["feedback_type"] == "comment"
        assert body["status"] == "open"
        assert body["client_name"] == "Jamie Client"
        assert body["created_at"] is not None

    def test_change_request_and_general_feedback_types_are_accepted(self, authed_client, client, monkeypatch):
        project, website, token = _build_project_with_approved_website_and_client_link(authed_client, monkeypatch)

        for feedback_type in ("change_request", "general", "approval", "rejection"):
            res = client.post(
                f"/api/v1/preview/{token}/websites/{website['id']}/feedback",
                json={"feedback_type": feedback_type, "message": f"Testing {feedback_type}"},
            )
            assert res.status_code == 201, res.text
            assert res.json()["feedback_type"] == feedback_type

    def test_rejects_a_page_slug_not_on_this_version(self, authed_client, client, monkeypatch):
        project, website, token = _build_project_with_approved_website_and_client_link(authed_client, monkeypatch)

        res = client.post(
            f"/api/v1/preview/{token}/websites/{website['id']}/feedback",
            json={"feedback_type": "comment", "message": "Where's the pricing page?", "page_slug": "nonexistent"},
        )
        assert res.status_code == 400

    def test_revoked_link_cannot_submit_feedback(self, authed_client, client, monkeypatch):
        project, website, token = _build_project_with_approved_website_and_client_link(authed_client, monkeypatch)
        links = authed_client.get(f"/api/v1/projects/{project['id']}/previews").json()
        authed_client.post(f"/api/v1/previews/{links[0]['id']}/revoke")

        res = client.post(
            f"/api/v1/preview/{token}/websites/{website['id']}/feedback",
            json={"feedback_type": "comment", "message": "Hello?"},
        )
        assert res.status_code == 410

    def test_feedback_is_recorded_in_the_activity_log(self, authed_client, client, monkeypatch):
        project, website, token = _build_project_with_approved_website_and_client_link(authed_client, monkeypatch)
        client.post(
            f"/api/v1/preview/{token}/websites/{website['id']}/feedback",
            json={"feedback_type": "comment", "message": "Nice work.", "client_name": "Jamie Client"},
        )

        activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
        entries = [a for a in activity if a["action"] == "website_feedback_submitted"]
        assert len(entries) == 1
        assert "Jamie Client" in entries[0]["summary"]


class TestListAndUpdateFeedback:
    def test_requires_auth(self, client):
        res = client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/feedback")
        assert res.status_code == 401

    def test_unknown_project_404s(self, authed_client):
        res = authed_client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/feedback")
        assert res.status_code == 404

    def test_lists_newest_first(self, authed_client, client, monkeypatch):
        project, website, token = _build_project_with_approved_website_and_client_link(authed_client, monkeypatch)
        client.post(f"/api/v1/preview/{token}/websites/{website['id']}/feedback", json={"feedback_type": "comment", "message": "First"})
        client.post(f"/api/v1/preview/{token}/websites/{website['id']}/feedback", json={"feedback_type": "comment", "message": "Second"})

        res = authed_client.get(f"/api/v1/projects/{project['id']}/feedback")
        assert res.status_code == 200
        messages = [f["message"] for f in res.json()]
        assert messages == ["Second", "First"]

    def test_update_status_to_resolved_records_actor_and_timestamp(self, authed_client, client, monkeypatch):
        project, website, token = _build_project_with_approved_website_and_client_link(authed_client, monkeypatch)
        created = client.post(
            f"/api/v1/preview/{token}/websites/{website['id']}/feedback",
            json={"feedback_type": "change_request", "message": "Please swap this photo."},
        ).json()

        res = authed_client.patch(
            f"/api/v1/feedback/{created['id']}", json={"status": "resolved", "resolution_notes": "Swapped in the new photo."}
        )
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "resolved"
        assert body["resolved_by_user_name"] == "Ada Admin"
        assert body["resolved_at"] is not None
        assert body["resolution_notes"] == "Swapped in the new photo."

    def test_update_unknown_404s(self, authed_client):
        res = authed_client.patch(
            "/api/v1/feedback/00000000-0000-0000-0000-000000000000", json={"status": "acknowledged"}
        )
        assert res.status_code == 404

    def test_workspace_isolated(self, authed_client, other_authed_client, client, monkeypatch):
        project, website, token = _build_project_with_approved_website_and_client_link(authed_client, monkeypatch)
        created = client.post(
            f"/api/v1/preview/{token}/websites/{website['id']}/feedback",
            json={"feedback_type": "comment", "message": "Hi"},
        ).json()

        assert other_authed_client.get(f"/api/v1/projects/{project['id']}/feedback").status_code == 404
        assert other_authed_client.patch(f"/api/v1/feedback/{created['id']}", json={"status": "acknowledged"}).status_code == 404
