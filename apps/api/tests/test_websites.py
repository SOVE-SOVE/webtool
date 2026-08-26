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
        {
            "title": "Contact",
            "slug": "contact",
            "page_type": "contact",
            "parent_slug": None,
            "nav_placement": "primary_nav",
            "purpose": "Every remaining way to reach the business.",
            "primary_cta": "Send message",
            "secondary_cta": None,
            "key_sections": ["Contact form"],
            "required_content": [],
            "required_functionality": [],
        },
    ],
}


def _patch_sitemap_agent(monkeypatch, output=None):
    monkeypatch.setattr(
        "app.agents.sitemap.generate_structured",
        lambda **kwargs: dict(output or SITEMAP_LLM_OUTPUT),
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
    if brief_fields:
        _set_brief(authed_client, project["id"], **brief_fields)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    return project, sitemap


_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "services_content": "Blocked drains\nHot water systems\nLeak detection",
    "contact_email": "hello@riversideplumbing.com.au",
    "contact_phone": "0412 345 678",
    "testimonials": "Fixed our hot water same afternoon.",
}


def _all_sections(website_body):
    sections = [website_body["navigation"], website_body["footer"]]
    for page in website_body["pages"]:
        sections.extend(page["sections"])
    return sections


class TestGenerateWebsite:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/websites")
        assert res.status_code == 401

    def test_unknown_project_404s(self, authed_client):
        res = authed_client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/websites")
        assert res.status_code == 404

    def test_no_sitemap_yet_400s(self, authed_client):
        project = _create_project_without_lead(authed_client)
        res = authed_client.post(f"/api/v1/projects/{project['id']}/websites")
        assert res.status_code == 400

    def test_happy_path_builds_pages_matching_the_sitemap(self, authed_client, monkeypatch):
        project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)

        res = authed_client.post(f"/api/v1/projects/{project['id']}/websites")
        assert res.status_code == 201
        body = res.json()

        assert body["project_id"] == project["id"]
        assert [p["slug"] for p in body["pages"]] == ["", "services", "contact"]
        assert body["navigation"]["config"]["logo"]["label"] == "Riverside Plumbing"
        assert body["footer"]["config"]["copyrightHolder"] == "Riverside Plumbing"

        home = body["pages"][0]
        assert home["sections"][0]["type"] == "hero"
        assert "Licensed local plumbers" in home["sections"][0]["config"]["subheading"]

        services = next(p for p in body["pages"] if p["slug"] == "services")
        cards = next(s for s in services["sections"] if s["type"] == "serviceCards")
        assert [i["title"] for i in cards["config"]["services"]] == [
            "Blocked drains",
            "Hot water systems",
            "Leak detection",
        ]

        contact = next(p for p in body["pages"] if p["slug"] == "contact")
        contact_section = next(s for s in contact["sections"] if s["type"] == "contact")
        assert contact_section["config"]["details"][0]["value"] == "hello@riversideplumbing.com.au"

        # Real content, no author name captured for the testimonial —
        # flagged, never invented.
        assert any("no author name captured" in m for m in body["missing_information"])
        assert body["anti_slop_score"] == 100

        list_res = authed_client.get(f"/api/v1/projects/{project['id']}/websites")
        assert list_res.status_code == 200
        assert len(list_res.json()) == 1

        get_res = authed_client.get(f"/api/v1/websites/{body['id']}")
        assert get_res.status_code == 200
        assert get_res.json() == body

    def test_every_section_has_a_stable_id_and_starts_unapproved(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        body = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        sections = _all_sections(body)
        assert all(s["id"] for s in sections)
        assert len({s["id"] for s in sections}) == len(sections)
        assert all(s["approved"] is False for s in sections)

    def test_thin_content_is_flagged_for_review(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch)
        body = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        assert body["flagged_for_review"] is True
        assert len(body["missing_information"]) > 0


class TestUpdateSection:
    def test_approve_toggle_persists_and_does_not_create_a_new_version(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        hero_id = website["pages"][0]["sections"][0]["id"]

        res = authed_client.patch(f"/api/v1/websites/{website['id']}/sections/{hero_id}", json={"approved": True})
        assert res.status_code == 200
        updated_hero = next(s for s in res.json()["pages"][0]["sections"] if s["id"] == hero_id)
        assert updated_hero["approved"] is True

        versions = authed_client.get(f"/api/v1/projects/{project['id']}/websites").json()
        assert len(versions) == 1

    def test_config_edit_is_shallow_merged_not_replaced(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        hero = website["pages"][0]["sections"][0]
        assert hero["type"] == "hero"
        original_subheading = hero["config"]["subheading"]

        res = authed_client.patch(
            f"/api/v1/websites/{website['id']}/sections/{hero['id']}",
            json={"config": {"heading": "Riverside Plumbing — Ipswich's trusted local plumber"}},
        )
        assert res.status_code == 200
        updated_hero = next(s for s in res.json()["pages"][0]["sections"] if s["id"] == hero["id"])
        assert updated_hero["config"]["heading"] == "Riverside Plumbing — Ipswich's trusted local plumber"
        # Untouched key survives the merge.
        assert updated_hero["config"]["subheading"] == original_subheading

    def test_unknown_section_id_404s(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        res = authed_client.patch(f"/api/v1/websites/{website['id']}/sections/does-not-exist", json={"approved": True})
        assert res.status_code == 404


class TestRegenerateSection:
    def test_regenerating_one_section_creates_a_new_version_leaving_others_unchanged(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        v1 = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        hero = v1["pages"][0]["sections"][0]

        res = authed_client.post(f"/api/v1/websites/{v1['id']}/sections/{hero['id']}/regenerate")
        assert res.status_code == 201
        v2 = res.json()
        assert v2["id"] != v1["id"]

        new_hero = v2["pages"][0]["sections"][0]
        assert new_hero["type"] == "hero"
        assert new_hero["id"] != hero["id"]
        assert new_hero["approved"] is False

        # Everything else on the page carried over unchanged.
        assert [s["type"] for s in v2["pages"][0]["sections"]] == [s["type"] for s in v1["pages"][0]["sections"]]

        versions = authed_client.get(f"/api/v1/projects/{project['id']}/websites").json()
        assert len(versions) == 2

    def test_unknown_section_id_404s(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        res = authed_client.post(f"/api/v1/websites/{website['id']}/sections/does-not-exist/regenerate")
        assert res.status_code == 404

    def test_regenerating_a_section_keeps_the_needs_review_flag_on_a_version_with_gaps(
        self, authed_client, monkeypatch
    ):
        """The new version carries the old one's `missing_information`
        forward and get_website goes on displaying it, so the summary
        flag has to agree — otherwise regenerating any section quietly
        clears the "needs review" badge on a site that still has gaps."""
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        v1 = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        assert v1["missing_information"], "fixture should have unfilled content gaps"
        assert v1["flagged_for_review"] is True

        hero = v1["pages"][0]["sections"][0]
        v2 = authed_client.post(f"/api/v1/websites/{v1['id']}/sections/{hero['id']}/regenerate").json()
        assert v2["missing_information"]
        summaries = authed_client.get(f"/api/v1/projects/{project['id']}/websites").json()
        assert next(v for v in summaries if v["id"] == v2["id"])["flagged_for_review"] is True


class TestRegenerateWholeWebsitePreservesApprovals:
    def test_approved_sections_survive_a_full_regenerate_by_default(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        v1 = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        hero = v1["pages"][0]["sections"][0]

        authed_client.patch(
            f"/api/v1/websites/{v1['id']}/sections/{hero['id']}",
            json={"config": {"heading": "A hand-edited, approved headline"}, "approved": True},
        )

        v2 = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        new_hero = v2["pages"][0]["sections"][0]
        assert new_hero["id"] == hero["id"]
        assert new_hero["approved"] is True
        assert new_hero["config"]["heading"] == "A hand-edited, approved headline"

    def test_force_regenerate_all_discards_approvals(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        v1 = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        hero = v1["pages"][0]["sections"][0]
        authed_client.patch(f"/api/v1/websites/{v1['id']}/sections/{hero['id']}", json={"approved": True})

        v2 = authed_client.post(
            f"/api/v1/projects/{project['id']}/websites", json={"force_regenerate_all": True}
        ).json()
        new_hero = v2["pages"][0]["sections"][0]
        assert new_hero["id"] != hero["id"]
        assert new_hero["approved"] is False


class TestWorkspaceIsolation:
    def test_websites_are_workspace_isolated(self, authed_client, other_authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        section_id = website["navigation"]["id"]

        assert other_authed_client.post(f"/api/v1/projects/{project['id']}/websites").status_code == 404
        assert other_authed_client.get(f"/api/v1/projects/{project['id']}/websites").status_code == 404
        assert other_authed_client.get(f"/api/v1/websites/{website['id']}").status_code == 404
        assert (
            other_authed_client.patch(
                f"/api/v1/websites/{website['id']}/sections/{section_id}", json={"approved": True}
            ).status_code
            == 404
        )
        assert (
            other_authed_client.post(f"/api/v1/websites/{website['id']}/sections/{section_id}/regenerate").status_code
            == 404
        )


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


def _create_fully_approved_website(authed_client, monkeypatch):
    """A project with brief, creative direction, and sitemap all
    approved, plus a generated (but not yet approved) website — the
    starting point for approval-checkpoint tests."""
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )
    project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
    authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")
    cd = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()
    authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
    website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
    return project, website


class TestApproveWebsite:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/websites/00000000-0000-0000-0000-000000000000/approve")
        assert res.status_code == 401

    def test_blocked_when_prior_checkpoints_are_missing(self, authed_client, monkeypatch):
        project, _ = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        # Sitemap is approved by the helper, but brief/creative direction are not.
        website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()

        res = authed_client.post(f"/api/v1/websites/{website['id']}/approve")
        assert res.status_code == 400
        assert "client brief" in res.json()["detail"]
        assert "creative direction" in res.json()["detail"]

    def test_happy_path_records_who_when_and_notes(self, authed_client, monkeypatch):
        _, website = _create_fully_approved_website(authed_client, monkeypatch)

        res = authed_client.post(f"/api/v1/websites/{website['id']}/approve", json={"notes": "Looks great, ship it"})
        assert res.status_code == 200
        body = res.json()
        assert body["approved"] is True
        assert body["approved_by_user_name"] == "Ada Admin"
        assert body["approved_at"] is not None
        assert body["approval_notes"] == "Looks great, ship it"

    def test_editing_a_sections_content_reverts_website_approval(self, authed_client, monkeypatch):
        _, website = _create_fully_approved_website(authed_client, monkeypatch)
        authed_client.post(f"/api/v1/websites/{website['id']}/approve")
        hero_id = website["pages"][0]["sections"][0]["id"]

        res = authed_client.patch(
            f"/api/v1/websites/{website['id']}/sections/{hero_id}", json={"config": {"heading": "New heading"}}
        )
        assert res.status_code == 200
        assert res.json()["approved"] is False

    def test_toggling_a_sections_own_approved_flag_does_not_revert_website_approval(self, authed_client, monkeypatch):
        _, website = _create_fully_approved_website(authed_client, monkeypatch)
        authed_client.post(f"/api/v1/websites/{website['id']}/approve")
        hero_id = website["pages"][0]["sections"][0]["id"]

        res = authed_client.patch(f"/api/v1/websites/{website['id']}/sections/{hero_id}", json={"approved": True})
        assert res.status_code == 200
        assert res.json()["approved"] is True


class TestClientApproveWebsite:
    def test_blocked_until_website_itself_is_approved(self, authed_client, monkeypatch):
        _, website = _create_fully_approved_website(authed_client, monkeypatch)
        res = authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
        assert res.status_code == 400
        assert "approved" in res.json()["detail"]

    def test_blocked_until_qa_is_approved(self, authed_client, monkeypatch):
        _, website = _create_fully_approved_website(authed_client, monkeypatch)
        authed_client.post(f"/api/v1/websites/{website['id']}/approve")

        res = authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
        assert res.status_code == 400
        assert "QA" in res.json()["detail"]

    def test_happy_path(self, authed_client, monkeypatch):
        _, website = _create_fully_approved_website(authed_client, monkeypatch)
        authed_client.post(f"/api/v1/websites/{website['id']}/approve")
        qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")

        res = authed_client.post(f"/api/v1/websites/{website['id']}/client-approve", json={"notes": "Client signed off via email"})
        assert res.status_code == 200
        body = res.json()
        assert body["client_approved"] is True
        assert body["client_approved_by_user_name"] == "Ada Admin"
        assert body["client_approval_notes"] == "Client signed off via email"


def _patch_content_generator(monkeypatch, pages, missing_information=None):
    monkeypatch.setattr(
        "app.agents.content_generator.generate_structured",
        lambda **kwargs: {"pages": pages, "missing_information": missing_information or []},
    )


class TestContentDraftEnrichesGeneratedWebsite:
    """Roadmap Task 2 ("website component generation"): an approved,
    AI-drafted ContentDraft's grounded copy should flow into the
    deterministic website generator's config fields — without ever
    introducing a section type the design system's registry doesn't
    already define."""

    def test_generated_website_prefers_approved_drafted_copy(self, authed_client, monkeypatch):
        project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        home_id = next(p["id"] for p in sitemap["pages"] if p["page_type"] == "home")
        services_id = next(p["id"] for p in sitemap["pages"] if p["page_type"] == "services")

        _patch_content_generator(
            monkeypatch,
            [
                {
                    "page_id": home_id,
                    "seo_title": "Riverside Plumbing — Ipswich's Local Plumber",
                    "meta_description": "Drafted description of Riverside Plumbing's Ipswich service.",
                    "hero_heading": "Ipswich plumbing, done right the first time",
                    "hero_subheading": "Riverside Plumbing has served Ipswich homes since 2011.",
                    "cta_heading": "Book a Riverside Plumbing callout",
                    "cta_body": "Same-week appointments for Ipswich homes.",
                    "services": [],
                    "faqs": [],
                },
                {
                    "page_id": services_id,
                    "services": [
                        {"title": "Blocked drains", "description": "Camera-inspected clearing of blocked drains across Ipswich."},
                        {"title": "Hot water systems", "description": "Same-day repairs and replacements for local hot water systems."},
                        {"title": "Leak detection", "description": "Non-invasive leak detection before damage spreads."},
                    ],
                    "faqs": [],
                },
            ],
        )
        draft = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()
        authed_client.post(f"/api/v1/content-drafts/{draft['id']}/approve")

        body = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()

        home = body["pages"][0]
        assert home["seo"]["title"] == "Riverside Plumbing — Ipswich's Local Plumber"
        assert home["seo"]["meta_description"] == "Drafted description of Riverside Plumbing's Ipswich service."
        hero = home["sections"][0]
        assert hero["type"] == "hero"
        assert hero["config"]["heading"] == "Ipswich plumbing, done right the first time"
        assert hero["config"]["subheading"] == "Riverside Plumbing has served Ipswich homes since 2011."
        cta = next(s for s in home["sections"] if s["type"] == "cta")
        assert cta["config"]["heading"] == "Book a Riverside Plumbing callout"
        assert cta["config"]["body"] == "Same-week appointments for Ipswich homes."

        services = next(p for p in body["pages"] if p["slug"] == "services")
        cards = next(s for s in services["sections"] if s["type"] == "serviceCards")
        descriptions = {i["title"]: i["description"] for i in cards["config"]["services"]}
        assert descriptions["Blocked drains"] == "Camera-inspected clearing of blocked drains across Ipswich."
        assert descriptions["Hot water systems"] == "Same-day repairs and replacements for local hot water systems."

        # Every section produced is still one of packages/site-templates'
        # registered types — content enrichment never introduces new
        # architecture, it only fills fields the design system already
        # defines for hero/cta/serviceCards.
        assert {s["type"] for s in _all_sections(body)} <= {
            "navigation",
            "footer",
            "hero",
            "serviceCards",
            "cta",
            "contact",
            "testimonials",
        }

    def test_unapproved_content_draft_is_not_used(self, authed_client, monkeypatch):
        """An approved-first, fall-back-to-latest resolution still uses
        the latest draft when nothing is approved yet (same convention
        as sitemap/creative-direction), but a rejected/edited-away draft
        should never silently win over one the operator did approve."""
        project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        home_id = next(p["id"] for p in sitemap["pages"] if p["page_type"] == "home")

        _patch_content_generator(monkeypatch, [{"page_id": home_id, "hero_heading": "Approved heading"}])
        approved_draft = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()
        authed_client.post(f"/api/v1/content-drafts/{approved_draft['id']}/approve")

        _patch_content_generator(monkeypatch, [{"page_id": home_id, "hero_heading": "Newer unapproved heading"}])
        authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts")

        body = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        assert body["pages"][0]["sections"][0]["config"]["heading"] == "Approved heading"


class TestRollbackWebsite:
    def test_rollback_creates_new_version_with_old_config_and_unapproved(self, authed_client, monkeypatch):
        project, sitemap = _create_project_with_sitemap(authed_client, monkeypatch, _REAL_BRIEF)
        home_id = next(p["id"] for p in sitemap["pages"] if p["page_type"] == "home")

        _patch_content_generator(monkeypatch, [{"page_id": home_id, "hero_heading": "Version one heading"}])
        draft_v1 = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()
        authed_client.post(f"/api/v1/content-drafts/{draft_v1['id']}/approve")
        v1 = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        authed_client.post(f"/api/v1/websites/{v1['id']}/approve")

        _patch_content_generator(monkeypatch, [{"page_id": home_id, "hero_heading": "Version two heading"}])
        draft_v2 = authed_client.post(f"/api/v1/projects/{project['id']}/content-drafts").json()
        authed_client.post(f"/api/v1/content-drafts/{draft_v2['id']}/approve")
        v2 = authed_client.post(f"/api/v1/projects/{project['id']}/websites", json={"force_regenerate_all": True}).json()
        assert v2["pages"][0]["sections"][0]["config"]["heading"] == "Version two heading"

        res = authed_client.post(f"/api/v1/websites/{v1['id']}/rollback")
        assert res.status_code == 201
        restored = res.json()
        assert restored["id"] not in (v1["id"], v2["id"])
        assert restored["approved"] is False
        assert restored["pages"][0]["sections"][0]["config"]["heading"] == "Version one heading"

        versions = authed_client.get(f"/api/v1/projects/{project['id']}/websites").json()
        assert versions[0]["id"] == restored["id"]

        activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
        assert any(a["action"] == "website_rolled_back" for a in activity)

    def test_rollback_unknown_website_404s(self, authed_client):
        res = authed_client.post("/api/v1/websites/00000000-0000-0000-0000-000000000000/rollback")
        assert res.status_code == 404
