SITEMAP_LLM_OUTPUT = {
    "overview": "A compact site for a residential plumber.",
    "pages": [
        {
            "title": "Home", "slug": "", "page_type": "home", "parent_slug": None,
            "nav_placement": "primary_nav", "purpose": "Convert a visitor into a phone call.",
            "primary_cta": "Get a quote", "secondary_cta": None,
            "key_sections": ["Hero"], "required_content": [], "required_functionality": [],
        },
        {
            "title": "Contact", "slug": "contact", "page_type": "contact", "parent_slug": None,
            "nav_placement": "primary_nav", "purpose": "Every remaining way to reach the business.",
            "primary_cta": "Send message", "secondary_cta": None,
            "key_sections": ["Contact form"], "required_content": [], "required_functionality": [],
        },
    ],
}


def _patch_sitemap_agent(monkeypatch, output=None):
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(output or SITEMAP_LLM_OUTPUT))


def _create_project_without_lead(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post("/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}).json()
    project = authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}).json()
    return project


_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "contact_email": "hello@riversideplumbing.com.au",
}


def _create_website(authed_client, monkeypatch, brief_fields=None):
    _patch_sitemap_agent(monkeypatch)
    project = _create_project_without_lead(authed_client)
    authed_client.patch(f"/api/v1/projects/{project['id']}/brief", json=brief_fields or _REAL_BRIEF)
    sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
    return project, website


class TestGenerateQaReport:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/websites/00000000-0000-0000-0000-000000000000/qa-reports")
        assert res.status_code == 401

    def test_unknown_website_404s(self, authed_client):
        res = authed_client.post("/api/v1/websites/00000000-0000-0000-0000-000000000000/qa-reports")
        assert res.status_code == 404

    def test_happy_path_returns_a_full_structured_report(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)

        res = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports")
        assert res.status_code == 201
        body = res.json()

        assert body["website_id"] == website["id"]
        assert body["kind"] == "automated"
        assert isinstance(body["passed"], bool)
        assert len(body["checks"]) > 0
        categories = {c["category"] for c in body["checks"]}
        assert categories == {"performance", "responsiveness", "accessibility", "seo", "functionality", "security", "markup"}
        assert body["passed_count"] + body["failed_count"] + body["warning_count"] + body["skipped_count"] == len(body["checks"])

    def test_never_hides_failures_every_check_is_present_in_the_response(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        res = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports")
        body = res.json()
        # Missing meta description on this fixture is a real, expected warning.
        assert any(c["status"] == "warning" for c in body["checks"])

    def test_list_and_get_after_generating(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()

        list_res = authed_client.get(f"/api/v1/websites/{website['id']}/qa-reports")
        assert list_res.status_code == 200
        assert len(list_res.json()) == 1

        get_res = authed_client.get(f"/api/v1/qa-reports/{report['id']}")
        assert get_res.status_code == 200
        assert get_res.json()["id"] == report["id"]

    def test_running_qa_again_creates_a_new_report_not_overwriting_the_old_one(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports")
        authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports")

        reports = authed_client.get(f"/api/v1/websites/{website['id']}/qa-reports").json()
        assert len(reports) == 2

    def test_website_with_a_broken_internal_link_is_not_ready_for_review(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        hero_id = website["pages"][0]["sections"][0]["id"]
        authed_client.patch(
            f"/api/v1/websites/{website['id']}/sections/{hero_id}",
            json={"config": {"primaryCta": {"label": "Pricing", "href": "/pricing"}}},
        )

        res = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports")
        body = res.json()
        assert body["passed"] is False
        link_check = next(c for c in body["checks"] if c["name"] == "Internal links resolve")
        assert link_check["status"] == "fail"
        assert link_check["severity"] == "critical"


class TestWorkspaceIsolation:
    def test_qa_reports_are_workspace_isolated(self, authed_client, other_authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()

        assert other_authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").status_code == 404
        assert other_authed_client.get(f"/api/v1/websites/{website['id']}/qa-reports").status_code == 404
        assert other_authed_client.get(f"/api/v1/qa-reports/{report['id']}").status_code == 404


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


def _create_approved_website(authed_client, monkeypatch):
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )
    project, website = _create_website(authed_client, monkeypatch)
    authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")
    cd = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()
    authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
    authed_client.post(f"/api/v1/websites/{website['id']}/approve")
    return project, website


class TestApproveQaReport:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/qa-reports/00000000-0000-0000-0000-000000000000/approve")
        assert res.status_code == 401

    def test_rejects_a_report_with_unresolved_critical_issues(self, authed_client, monkeypatch):
        project, website = _create_approved_website(authed_client, monkeypatch)
        hero_id = website["pages"][0]["sections"][0]["id"]
        authed_client.patch(
            f"/api/v1/websites/{website['id']}/sections/{hero_id}",
            json={"config": {"primaryCta": {"label": "Pricing", "href": "/pricing"}}},
        )
        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        assert report["passed"] is False

        res = authed_client.post(f"/api/v1/qa-reports/{report['id']}/approve")
        assert res.status_code == 400
        assert "critical" in res.json()["detail"].lower()

    def test_rejects_when_website_is_not_yet_approved(self, authed_client, monkeypatch):
        _, website = _create_website(authed_client, monkeypatch)
        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()

        res = authed_client.post(f"/api/v1/qa-reports/{report['id']}/approve")
        assert res.status_code == 400
        assert "approved" in res.json()["detail"].lower()

    def test_happy_path_records_who_when_and_notes(self, authed_client, monkeypatch):
        _, website = _create_approved_website(authed_client, monkeypatch)
        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()

        res = authed_client.post(f"/api/v1/qa-reports/{report['id']}/approve", json={"notes": "Reviewed, all good"})
        assert res.status_code == 200
        body = res.json()
        assert body["human_approved"] is True
        assert body["approved_by_user_name"] == "Ada Admin"
        assert body["approval_notes"] == "Reviewed, all good"

        summary = authed_client.get(f"/api/v1/websites/{website['id']}/qa-reports").json()
        assert summary[0]["human_approved"] is True


class TestContentEditRevertsQaApproval:
    """Editing a section after QA was signed off invalidates that
    sign-off — the report was run against the content as it was before
    the edit, and leaving it approved lets unreviewed content through
    both the client-review gate and the pre-deploy critical-issue check."""

    def test_editing_a_section_clears_the_qa_sign_off(self, authed_client, monkeypatch):
        _, website = _create_approved_website(authed_client, monkeypatch)
        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        authed_client.post(f"/api/v1/qa-reports/{report['id']}/approve")

        full = authed_client.get(f"/api/v1/websites/{website['id']}").json()
        section = full["pages"][0]["sections"][0]
        authed_client.patch(
            f"/api/v1/websites/{website['id']}/sections/{section['id']}",
            json={"config": {**section["config"], "heading": "Edited after QA"}},
        )

        assert authed_client.get(f"/api/v1/qa-reports/{report['id']}").json()["human_approved"] is False

    def test_client_approval_is_refused_until_qa_is_re_run_and_re_approved(self, authed_client, monkeypatch):
        _, website = _create_approved_website(authed_client, monkeypatch)
        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        authed_client.post(f"/api/v1/qa-reports/{report['id']}/approve")

        full = authed_client.get(f"/api/v1/websites/{website['id']}").json()
        section = full["pages"][0]["sections"][0]
        authed_client.patch(
            f"/api/v1/websites/{website['id']}/sections/{section['id']}",
            json={"config": {**section["config"], "heading": "Edited after QA"}},
        )
        authed_client.post(f"/api/v1/websites/{website['id']}/approve")

        res = authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
        assert res.status_code == 400
        assert "QA" in res.json()["detail"]

    def test_toggling_a_sections_approved_flag_alone_does_not_clear_qa(self, authed_client, monkeypatch):
        _, website = _create_approved_website(authed_client, monkeypatch)
        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        authed_client.post(f"/api/v1/qa-reports/{report['id']}/approve")

        full = authed_client.get(f"/api/v1/websites/{website['id']}").json()
        section = full["pages"][0]["sections"][0]
        authed_client.patch(
            f"/api/v1/websites/{website['id']}/sections/{section['id']}", json={"approved": True}
        )

        assert authed_client.get(f"/api/v1/qa-reports/{report['id']}").json()["human_approved"] is True


class TestNonRootHomeSlug:
    """A sitemap whose home page has an ordinary slug ("home", not the
    empty string) is what the operator UI actually produces — it must
    still reach a passing QA report, not dead-end on a broken link the
    generator itself created."""

    def test_qa_passes_and_the_whole_chain_can_be_approved(self, authed_client, monkeypatch):
        sitemap_output = {
            "overview": "A compact site for a residential plumber.",
            "pages": [
                {**SITEMAP_LLM_OUTPUT["pages"][0], "slug": "home"},
                SITEMAP_LLM_OUTPUT["pages"][1],
            ],
        }
        monkeypatch.setattr(
            "app.agents.sitemap.generate_structured", lambda **kwargs: dict(sitemap_output)
        )
        monkeypatch.setattr(
            "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
        )
        project = _create_project_without_lead(authed_client)
        authed_client.patch(f"/api/v1/projects/{project['id']}/brief", json=_REAL_BRIEF)
        sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
        authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
        website = authed_client.post(f"/api/v1/projects/{project['id']}/websites").json()
        authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")
        cd = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()
        authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
        authed_client.post(f"/api/v1/websites/{website['id']}/approve")

        report = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        broken = [c for c in report["checks"] if c["name"] == "Internal links resolve"]
        assert broken and broken[0]["status"] == "pass", broken
        assert report["passed"] is True

        assert authed_client.post(f"/api/v1/qa-reports/{report['id']}/approve").status_code == 200
        assert authed_client.post(f"/api/v1/websites/{website['id']}/client-approve").status_code == 200

        approvals = authed_client.get(f"/api/v1/projects/{project['id']}/approvals").json()
        assert approvals["can_deploy"] is True, approvals["missing_for_deployment"]
        assert authed_client.post(f"/api/v1/projects/{project['id']}/deployments").status_code == 201
