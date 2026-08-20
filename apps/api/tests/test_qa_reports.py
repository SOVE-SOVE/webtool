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
        assert categories == {"performance", "responsiveness", "accessibility", "seo", "functionality", "security"}
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
