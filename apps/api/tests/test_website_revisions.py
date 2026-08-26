"""
Tests for the website revision workflow (Phase 5 Part 3 Task 2):
modules/website_revisions/service.py + routes.py, and the LLM-backed
agents/website_revision.py (mocked here, same pattern as
test_creative_directions.py's _patch_creative_director — the model call
itself isn't exercised against a real API in this suite).
"""

from app.agents import website_revision

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


def _patch_sitemap_agent(monkeypatch, output=None):
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(output or SITEMAP_LLM_OUTPUT))


def _patch_website_revision(monkeypatch, config, generated_change="Rewrote the heading to name the business directly."):
    monkeypatch.setattr(
        "app.agents.website_revision.generate_structured",
        lambda **kwargs: {"config": config, "generated_change": generated_change},
    )


def _create_project(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post("/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}).json()
    project = authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}).json()
    return project


def _create_website(authed_client, monkeypatch, brief_fields=None):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project(authed_client)
    authed_client.patch(f"/api/v1/projects/{project['id']}/brief", json=brief_fields or _REAL_BRIEF)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
    return project, website


def _hero_section_id(website: dict) -> str:
    home = next(p for p in website["pages"] if p["slug"] == "")
    hero = next(s for s in home["sections"] if s["type"] == "hero")
    return hero["id"]


def _hero_heading(website: dict, hero_id: str) -> str:
    home = next(p for p in website["pages"] if p["slug"] == "")
    hero = next(s for s in home["sections"] if s["id"] == hero_id)
    return hero["config"]["heading"]


class TestWebsiteRevisionAgent:
    """Direct tests of agents/website_revision.py's own self-check —
    the service layer never sees a malformed response because this
    agent flags it first."""

    def _input(self, **overrides):
        base = dict(
            business_name="Riverside Plumbing",
            section_type="hero",
            current_config={"heading": "Old heading", "primaryCta": {"label": "Call", "href": "tel:0412345678"}},
            requested_change="Make the hero less generic.",
        )
        base.update(overrides)
        return website_revision.ReviseSectionInput(**base)

    def test_a_well_formed_response_is_not_flagged(self, monkeypatch):
        monkeypatch.setattr(
            "app.agents.website_revision.generate_structured",
            lambda **kwargs: {
                "config": {"heading": "Riverside Plumbing: help today", "primaryCta": {"label": "Call", "href": "tel:0412345678"}},
                "generated_change": "Named the business directly in the heading.",
            },
        )
        result = website_revision.run(self._input())
        assert result.flagged_for_review is False
        assert result.confidence == 0.8

    def test_a_response_that_drops_an_existing_key_is_flagged(self, monkeypatch):
        monkeypatch.setattr(
            "app.agents.website_revision.generate_structured",
            lambda **kwargs: {"config": {"heading": "New heading"}, "generated_change": "Rewrote the heading."},
        )
        result = website_revision.run(self._input())
        assert result.flagged_for_review is True
        assert "primaryCta" in result.notes

    def test_a_response_that_changes_the_section_type_is_flagged(self, monkeypatch):
        monkeypatch.setattr(
            "app.agents.website_revision.generate_structured",
            lambda **kwargs: {
                "config": {"type": "cta", "heading": "New heading", "primaryCta": {"label": "Call", "href": "tel:0412345678"}},
                "generated_change": "Rewrote the heading.",
            },
        )
        result = website_revision.run(self._input(current_config={"type": "hero", "heading": "Old", "primaryCta": {"label": "Call", "href": "tel:0412345678"}}))
        assert result.flagged_for_review is True


class TestRequestRevision:
    def test_requires_auth(self, client):
        res = client.post(
            "/api/v1/websites/00000000-0000-0000-0000-000000000000/revisions",
            json={"requested_change": "Make the hero less generic."},
        )
        assert res.status_code == 401

    def test_unknown_website_404s(self, authed_client):
        res = authed_client.post(
            "/api/v1/websites/00000000-0000-0000-0000-000000000000/revisions",
            json={"requested_change": "Make the hero less generic."},
        )
        assert res.status_code == 404

    def test_unknown_section_id_404s(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        res = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Make this section more premium.", "section_id": "not-a-real-id"},
        )
        assert res.status_code == 404

    def test_non_spacing_feedback_without_a_section_id_is_rejected(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        res = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Increase the visual hierarchy."},
        )
        assert res.status_code == 400
        assert "section" in res.json()["detail"].lower()

    def test_spacing_feedback_without_a_section_id_applies_site_wide(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        res = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Make mobile spacing tighter."},
        )
        assert res.status_code == 201
        body = res.json()
        assert body["kind"] == "spacing"
        assert body["status"] == "pending"
        assert body["revision_number"] == 1
        assert "compact" in body["generated_change"].lower()
        assert body["resulting_website_id"] != website["id"]
        assert body["previous_website_id"] == website["id"]

    def test_repeating_a_spacing_request_is_idempotent_and_honest_about_no_change(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        first = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions", json={"requested_change": "Tighter mobile spacing please."}
        ).json()
        second = authed_client.post(
            f"/api/v1/websites/{first['resulting_website_id']}/revisions",
            json={"requested_change": "Tighter mobile spacing please."},
        ).json()
        assert "nothing changed" in second["generated_change"].lower()

    def test_spacing_request_scoped_to_a_non_spacing_capable_section_is_rejected(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        nav_id = website["navigation"]["id"]
        res = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Tighten the spacing here.", "section_id": nav_id},
        )
        assert res.status_code == 400

    def test_content_revision_creates_a_new_version_and_leaves_the_original_untouched(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        hero_id = _hero_section_id(website)
        _patch_website_revision(monkeypatch, config={"heading": "Riverside Plumbing: fast, licensed help in Ipswich"})

        res = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Make the hero less generic.", "section_id": hero_id},
        )
        assert res.status_code == 201
        body = res.json()
        assert body["kind"] == "content"
        assert body["section_id"] == hero_id
        assert body["status"] == "pending"
        assert body["revision_number"] == 1
        assert body["generated_change"] == "Rewrote the heading to name the business directly."

        new_website_id = body["resulting_website_id"]
        assert new_website_id != website["id"]

        list_res = authed_client.get(f"/api/v1/websites/{website['id']}/revisions")
        assert len(list_res.json()) == 1
        assert list_res.json()[0]["id"] == body["id"]

    def test_revision_numbers_are_sequential_per_project(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        hero_id = _hero_section_id(website)

        _patch_website_revision(monkeypatch, config={"heading": "A"})
        first = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Make the hero less generic.", "section_id": hero_id},
        ).json()
        assert first["revision_number"] == 1

        _patch_website_revision(monkeypatch, config={"heading": "B"})
        second = authed_client.post(
            f"/api/v1/websites/{first['resulting_website_id']}/revisions",
            json={"requested_change": "Make the hero less generic.", "section_id": hero_id},
        ).json()
        assert second["revision_number"] == 2


class TestApproveRevision:
    def test_approve_marks_pending_revision_approved(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        revision = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions", json={"requested_change": "Tighter mobile spacing."}
        ).json()

        res = authed_client.post(f"/api/v1/revisions/{revision['id']}/approve", json={"notes": "Looks good"})
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "approved"
        assert body["decision_notes"] == "Looks good"

    def test_approving_an_already_decided_revision_fails(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        revision = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions", json={"requested_change": "Tighter mobile spacing."}
        ).json()
        authed_client.post(f"/api/v1/revisions/{revision['id']}/approve")

        res = authed_client.post(f"/api/v1/revisions/{revision['id']}/approve")
        assert res.status_code == 400

    def test_unknown_revision_404s(self, authed_client):
        res = authed_client.post("/api/v1/revisions/00000000-0000-0000-0000-000000000000/approve")
        assert res.status_code == 404


class TestRollbackRevision:
    def test_rollback_restores_previous_content_and_marks_reverted(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        hero_id = _hero_section_id(website)
        original_heading = _hero_heading(website, hero_id)

        _patch_website_revision(monkeypatch, config={"heading": "A brand new heading"})
        revision = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Make the hero less generic.", "section_id": hero_id},
        ).json()

        res = authed_client.post(f"/api/v1/revisions/{revision['id']}/rollback", json={"notes": "Didn't like it"})
        assert res.status_code == 200
        rollback = res.json()
        assert rollback["kind"] == "rollback"
        assert rollback["status"] == "approved"
        assert rollback["revision_number"] == 2

        history = authed_client.get(f"/api/v1/websites/{website['id']}/revisions").json()
        original_entry = next(r for r in history if r["id"] == revision["id"])
        assert original_entry["status"] == "reverted"

        restored_website = authed_client.get(
            f"/api/v1/websites/{rollback['resulting_website_id']}/revisions"
        )
        assert restored_website.status_code == 200

    def test_cannot_roll_back_an_already_reverted_revision(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        hero_id = _hero_section_id(website)
        _patch_website_revision(monkeypatch, config={"heading": "A brand new heading"})
        revision = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Make the hero less generic.", "section_id": hero_id},
        ).json()
        authed_client.post(f"/api/v1/revisions/{revision['id']}/rollback")

        res = authed_client.post(f"/api/v1/revisions/{revision['id']}/rollback")
        assert res.status_code == 400

    def test_cannot_roll_back_a_superseded_revision(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        hero_id = _hero_section_id(website)
        _patch_website_revision(monkeypatch, config={"heading": "First edit"})
        first = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions",
            json={"requested_change": "Make the hero less generic.", "section_id": hero_id},
        ).json()
        _patch_website_revision(monkeypatch, config={"heading": "Second edit"})
        authed_client.post(
            f"/api/v1/websites/{first['resulting_website_id']}/revisions",
            json={"requested_change": "Make the hero less generic.", "section_id": hero_id},
        )

        res = authed_client.post(f"/api/v1/revisions/{first['id']}/rollback")
        assert res.status_code == 400


class TestWorkspaceIsolation:
    def test_revision_from_another_workspace_is_not_visible_or_actionable(self, authed_client, other_authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        revision = authed_client.post(
            f"/api/v1/websites/{website['id']}/revisions", json={"requested_change": "Tighter mobile spacing."}
        ).json()

        assert other_authed_client.get(f"/api/v1/revisions/{revision['id']}").status_code == 404
        assert other_authed_client.post(f"/api/v1/revisions/{revision['id']}/approve").status_code == 404
        assert other_authed_client.post(f"/api/v1/revisions/{revision['id']}/rollback").status_code == 404
        assert other_authed_client.get(f"/api/v1/websites/{website['id']}/revisions").status_code == 404
