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


class TestExecuteDeployment:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/deployments/00000000-0000-0000-0000-000000000000/execute")
        assert res.status_code == 401

    def test_unknown_deployment_404s(self, authed_client):
        res = authed_client.post("/api/v1/deployments/00000000-0000-0000-0000-000000000000/execute")
        assert res.status_code == 404

    def test_happy_path_marks_success_sets_url_and_advances_project_to_deployed(self, authed_client, monkeypatch):
        project, website = _build_deployable_project(authed_client, monkeypatch)
        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        assert prepared["status"] == "pending"

        res = authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "success"
        assert body["target"] == "mock"
        assert body["url"] is not None and body["url"].endswith(".mock-deploy.internal")
        assert body["error_message"] is None
        assert body["completed_at"] is not None
        assert body["deployed_at"] is not None
        assert body["result"]["provider"] == "mock"

        project_after = authed_client.get(f"/api/v1/projects/{project['id']}").json()
        assert project_after["stage"] == "deployed"

    def test_cannot_execute_an_already_succeeded_deployment_again(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute")

        res = authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute")
        assert res.status_code == 400

    def test_workspace_isolated(self, authed_client, other_authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()

        res = other_authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute")
        assert res.status_code == 404

    def test_get_single_deployment(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()

        res = authed_client.get(f"/api/v1/deployments/{prepared['id']}")
        assert res.status_code == 200
        assert res.json()["id"] == prepared["id"]


class TestRollbackDeployment:
    def test_requires_a_previously_successful_deployment(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        # Never executed — still "pending", not a valid rollback target.

        res = authed_client.post(
            f"/api/v1/projects/{project['id']}/deployments/rollback", json={"target_deployment_id": prepared["id"]}
        )
        assert res.status_code == 400

    def test_unknown_target_404s(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        res = authed_client.post(
            f"/api/v1/projects/{project['id']}/deployments/rollback",
            json={"target_deployment_id": "00000000-0000-0000-0000-000000000000"},
        )
        assert res.status_code == 404

    def test_happy_path_redeploys_the_target_version(self, authed_client, monkeypatch):
        project, website = _build_deployable_project(authed_client, monkeypatch)
        first = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        authed_client.post(f"/api/v1/deployments/{first['id']}/execute")

        res = authed_client.post(
            f"/api/v1/projects/{project['id']}/deployments/rollback", json={"target_deployment_id": first["id"]}
        )
        assert res.status_code == 201
        body = res.json()
        assert body["status"] == "success"
        assert body["website_id"] == website["id"]
        assert body["rollback_of_deployment_id"] == first["id"]

        deployments = authed_client.get(f"/api/v1/projects/{project['id']}/deployments").json()
        assert len(deployments) == 2


class TestPreDeployChecks:
    """Unit coverage for the pre-deploy check functions themselves —
    the happy-path integration tests above only exercise the case where
    every check passes, since a real generated website never has empty
    pages or secret-shaped content."""

    def test_required_assets_flags_a_website_with_no_pages(self):
        from app.modules.deployments.checks import check_required_assets
        from app.modules.websites.models import Website

        assert check_required_assets(Website(config={"pages": []})) != []
        assert check_required_assets(Website(config={"pages": [{"slug": "home"}]})) == []

    def test_no_exposed_secrets_flags_an_aws_key_but_not_ordinary_copy(self):
        from app.modules.deployments.checks import check_no_exposed_secrets
        from app.modules.websites.models import Website

        clean = Website(config={"pages": [{"sections": [{"config": {"body": "Our secret to 20 years in business."}}]}]})
        assert check_no_exposed_secrets(clean) == []

        leaked = Website(config={"pages": [{"sections": [{"config": {"body": "key=AKIAABCDEFGHIJKLMNOP"}}]}]})
        assert check_no_exposed_secrets(leaked) != []

    def test_required_configuration_domain_check_only_blocks_for_a_non_mock_provider(self):
        from app.modules.deployments.checks import check_required_configuration
        from app.modules.design_briefs.models import DesignBrief
        from app.modules.websites.models import Website

        website = Website(config={"pages": [{"slug": "home"}]})
        no_domain_brief = DesignBrief(domain=None)

        assert check_required_configuration(website, no_domain_brief, "production", "mock") == []
        assert check_required_configuration(website, no_domain_brief, "production", "real-host") != []
        assert check_required_configuration(website, DesignBrief(domain="example.com"), "production", "real-host") == []

    def test_critical_qa_resolved_requires_a_report_with_no_critical_fails(self):
        from app.modules.deployments.checks import check_critical_qa_resolved
        from app.modules.qa_reports.models import QaReport

        assert check_critical_qa_resolved(None) != []

        failing = QaReport(report={"checks": [{"status": "fail", "severity": "critical"}]})
        assert check_critical_qa_resolved(failing) != []

        passing = QaReport(report={"checks": [{"status": "fail", "severity": "low"}]})
        assert check_critical_qa_resolved(passing) == []


class TestMockDeploymentProvider:
    def test_deploy_returns_a_clearly_fake_mock_url_and_never_hits_the_network(self):
        from app.integrations.deployment.base import DeploymentBundle
        from app.integrations.deployment.mock_provider import MockDeploymentProvider

        provider = MockDeploymentProvider()
        bundle = DeploymentBundle(business_slug="Riverside Plumbing", environment="production", config={"pages": [{"slug": "", "seo": {"title": "Home"}, "sections": [{"type": "hero", "config": {"heading": "Welcome"}}]}]})
        artifact = provider.build(bundle)
        outcome = provider.deploy(bundle, artifact)
        assert outcome.ok is True
        assert outcome.target == "mock"
        assert outcome.url == "https://riverside-plumbing-production.mock-deploy.internal"
        assert outcome.detail["pages_deployed"] == 1
        assert outcome.provider_ref is not None

    def test_deploy_fails_cleanly_with_no_pages(self):
        from app.integrations.deployment.base import DeploymentBundle
        from app.integrations.deployment.mock_provider import MockDeploymentProvider

        provider = MockDeploymentProvider()
        bundle = DeploymentBundle(business_slug="Empty Co", environment="production", config={"pages": []})
        artifact = provider.build(bundle)
        assert artifact.ok is False
        outcome = provider.deploy(bundle, artifact)
        assert outcome.ok is False
        assert outcome.error is not None

    def test_get_status_reports_ready_and_rollback_is_simulated(self):
        from app.integrations.deployment.mock_provider import MockDeploymentProvider

        provider = MockDeploymentProvider()
        assert provider.get_status("mock-anything").state == "ready"
        rollback_outcome = provider.rollback("mock-anything")
        assert rollback_outcome.ok is True
        assert rollback_outcome.target == "mock"

    def test_unconfigured_provider_name_raises_instead_of_silently_falling_back(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.deployment.base import DeploymentProviderError
        from app.integrations.deployment.registry import get_deployment_provider

        monkeypatch.setattr(settings, "deploy_provider", "vercel")
        try:
            get_deployment_provider()
            assert False, "expected DeploymentProviderError"
        except DeploymentProviderError:
            pass

    def test_unknown_provider_name_raises(self):
        from app.integrations.deployment.base import DeploymentProviderError
        from app.integrations.deployment.registry import get_deployment_provider

        try:
            get_deployment_provider("not-a-real-provider")
            assert False, "expected DeploymentProviderError"
        except DeploymentProviderError:
            pass


class TestConcurrentExecution:
    def test_two_simultaneous_executes_publish_the_deployment_only_once(
        self, authed_client, admin_user, monkeypatch
    ):
        """Without a row lock both requests read "pending" and both run
        the provider — two real publishes of the same deployment once a
        provider that actually publishes exists. The slow provider keeps
        the requests genuinely overlapping."""
        import time
        from concurrent.futures import ThreadPoolExecutor

        from fastapi.testclient import TestClient

        from app.integrations.deployment.mock_provider import MockDeploymentProvider
        from app.main import app
        from tests.conftest import ADMIN_PASSWORD

        class _SlowProvider(MockDeploymentProvider):
            def deploy(self, bundle, artifact):
                time.sleep(0.3)
                return super().deploy(bundle, artifact)

        project, _ = _build_deployable_project(authed_client, monkeypatch)
        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        monkeypatch.setattr(
            "app.modules.deployments.service.get_deployment_provider", lambda: _SlowProvider()
        )

        clients = []
        for _ in range(4):
            c = TestClient(app)
            c.__enter__()
            c.post("/api/v1/auth/login", json={"email": admin_user.email, "password": ADMIN_PASSWORD})
            clients.append(c)
        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [
                    pool.submit(c.post, f"/api/v1/deployments/{prepared['id']}/execute") for c in clients
                ]
                statuses = [f.result().status_code for f in futures]
        finally:
            for c in clients:
                c.__exit__(None, None, None)

        assert statuses.count(200) == 1
        assert statuses.count(400) == 3

        activity = authed_client.get(
            f"/api/v1/activity?entity_type=project&entity_id={project['id']}"
        ).json()
        assert sum(1 for a in activity if a["action"] == "deployment_succeeded") == 1


class TestLaunchChecklist:
    """The post-launch handover steps are the easiest to forget once the
    build itself is done — seeded once, the first time a project
    actually reaches DEPLOYED. See docs/05_DECISIONS.md (2026-08-21)."""

    def _launch_tasks(self, authed_client, project_id):
        from app.modules.projects.service import DEFAULT_LAUNCH_TASK_TITLES

        tasks = authed_client.get("/api/v1/tasks").json()
        return [
            t for t in tasks if t["project_id"] == project_id and t["title"] in DEFAULT_LAUNCH_TASK_TITLES
        ]

    def test_a_successful_deploy_seeds_the_handover_checklist(self, authed_client, monkeypatch):
        from app.modules.projects.service import DEFAULT_LAUNCH_TASK_TITLES

        project, _ = _build_deployable_project(authed_client, monkeypatch)
        assert self._launch_tasks(authed_client, project["id"]) == []

        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute")

        titles = sorted(t["title"] for t in self._launch_tasks(authed_client, project["id"]))
        assert titles == sorted(DEFAULT_LAUNCH_TASK_TITLES)

    def test_a_redeploy_does_not_duplicate_the_checklist(self, authed_client, monkeypatch):
        from app.modules.projects.service import DEFAULT_LAUNCH_TASK_TITLES

        project, _ = _build_deployable_project(authed_client, monkeypatch)
        first = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        authed_client.post(f"/api/v1/deployments/{first['id']}/execute")

        second = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        authed_client.post(f"/api/v1/deployments/{second['id']}/execute")

        assert len(self._launch_tasks(authed_client, project["id"])) == len(DEFAULT_LAUNCH_TASK_TITLES)

    def test_a_prepared_but_unexecuted_deployment_seeds_nothing(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        authed_client.post(f"/api/v1/projects/{project['id']}/deployments")

        assert self._launch_tasks(authed_client, project["id"]) == []
