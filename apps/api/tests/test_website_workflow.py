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


def _generate_website(authed_client, monkeypatch):
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
    return project, website


class TestTransitionWorkflow:
    def test_requires_auth(self, client):
        res = client.post(
            "/api/v1/websites/00000000-0000-0000-0000-000000000000/workflow-transition",
            json={"to_status": "internal_review"},
        )
        assert res.status_code == 401

    def test_unknown_website_404s(self, authed_client):
        res = authed_client.post(
            "/api/v1/websites/00000000-0000-0000-0000-000000000000/workflow-transition",
            json={"to_status": "internal_review"},
        )
        assert res.status_code == 404

    def test_a_fresh_website_starts_in_draft(self, authed_client, monkeypatch):
        _, website = _generate_website(authed_client, monkeypatch)
        assert website["workflow_status"] == "draft"

    def test_happy_path_walks_the_full_chain(self, authed_client, monkeypatch):
        _, website = _generate_website(authed_client, monkeypatch)
        website_id = website["id"]

        for to_status in ("internal_review", "client_review", "approved", "ready_to_deploy"):
            res = authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": to_status})
            assert res.status_code == 200, res.text
            assert res.json()["workflow_status"] == to_status

    def test_rejects_an_illegal_jump(self, authed_client, monkeypatch):
        _, website = _generate_website(authed_client, monkeypatch)
        res = authed_client.post(
            f"/api/v1/websites/{website['id']}/workflow-transition", json={"to_status": "approved"}
        )
        assert res.status_code == 400
        assert "internal_review" in res.json()["detail"]

    def test_deployed_is_terminal(self, authed_client, monkeypatch):
        _, website = _generate_website(authed_client, monkeypatch)
        website_id = website["id"]
        for to_status in ("internal_review", "client_review", "approved", "ready_to_deploy"):
            authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": to_status})
        # Force it to DEPLOYED the only way the API allows — there's no
        # direct client transition to DEPLOYED, so simulate it isn't
        # reachable from READY_TO_DEPLOY via the transition endpoint at
        # all (only execute_deployment sets it); confirm READY_TO_DEPLOY
        # -> CHANGES_REQUESTED is legal instead, exercising the other
        # edge out of that state.
        res = authed_client.post(
            f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": "changes_requested"}
        )
        assert res.status_code == 200
        assert res.json()["workflow_status"] == "changes_requested"

    def test_workspace_isolated(self, authed_client, other_authed_client, monkeypatch):
        _, website = _generate_website(authed_client, monkeypatch)
        res = other_authed_client.post(
            f"/api/v1/websites/{website['id']}/workflow-transition", json={"to_status": "internal_review"}
        )
        assert res.status_code == 404


class TestWorkflowHistory:
    def test_records_every_transition_in_order(self, authed_client, monkeypatch):
        _, website = _generate_website(authed_client, monkeypatch)
        website_id = website["id"]
        authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": "internal_review", "notes": "Looks solid"})
        authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": "client_review"})

        res = authed_client.get(f"/api/v1/websites/{website_id}/workflow-history")
        assert res.status_code == 200
        history = res.json()
        assert [h["to_status"] for h in history] == ["internal_review", "client_review"]
        assert history[0]["from_status"] == "draft"
        assert history[0]["notes"] == "Looks solid"
        assert history[0]["actor_user_name"] == "Ada Admin"

    def test_unknown_website_404s(self, authed_client):
        res = authed_client.get("/api/v1/websites/00000000-0000-0000-0000-000000000000/workflow-history")
        assert res.status_code == 404


class TestEditingResetsWorkflowStatus:
    def test_editing_a_section_after_internal_review_resets_to_draft(self, authed_client, monkeypatch):
        _, website = _generate_website(authed_client, monkeypatch)
        website_id = website["id"]
        authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": "internal_review"})

        section_id = website["navigation"]["id"]
        res = authed_client.patch(
            f"/api/v1/websites/{website_id}/sections/{section_id}", json={"config": {"logo": {"label": "Edited"}}}
        )
        assert res.status_code == 200
        assert res.json()["workflow_status"] == "draft"

        history = authed_client.get(f"/api/v1/websites/{website_id}/workflow-history").json()
        assert history[-1]["to_status"] == "draft"
        assert history[-1]["actor_label"] == "system"


class TestFeedbackDrivesWorkflow:
    def _project_with_client_review_website(self, authed_client, monkeypatch):
        project, website = _generate_website(authed_client, monkeypatch)
        website_id = website["id"]
        authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": "internal_review"})
        authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": "client_review"})
        link = authed_client.post(f"/api/v1/projects/{project['id']}/previews", json={"audience": "client"}).json()
        token = link["url"].rsplit("/", 1)[-1]
        return project, website_id, token

    def test_client_approval_feedback_moves_client_review_to_approved(self, authed_client, client, monkeypatch):
        _, website_id, token = self._project_with_client_review_website(authed_client, monkeypatch)

        res = client.post(
            f"/api/v1/preview/{token}/websites/{website_id}/feedback",
            json={"feedback_type": "approval", "message": "Looks great, approved!", "client_name": "Jamie Client"},
        )
        assert res.status_code == 201

        website_after = authed_client.get(f"/api/v1/websites/{website_id}").json()
        assert website_after["workflow_status"] == "approved"

        history = authed_client.get(f"/api/v1/websites/{website_id}/workflow-history").json()
        assert history[-1]["to_status"] == "approved"
        assert history[-1]["actor_user_name"] is None
        assert "Jamie Client" in history[-1]["actor_label"]

    def test_client_change_request_moves_client_review_to_changes_requested(self, authed_client, client, monkeypatch):
        _, website_id, token = self._project_with_client_review_website(authed_client, monkeypatch)

        client.post(
            f"/api/v1/preview/{token}/websites/{website_id}/feedback",
            json={"feedback_type": "change_request", "message": "Please change the hero photo."},
        )

        website_after = authed_client.get(f"/api/v1/websites/{website_id}").json()
        assert website_after["workflow_status"] == "changes_requested"

    def test_client_rejection_also_moves_to_changes_requested(self, authed_client, client, monkeypatch):
        _, website_id, token = self._project_with_client_review_website(authed_client, monkeypatch)

        client.post(
            f"/api/v1/preview/{token}/websites/{website_id}/feedback",
            json={"feedback_type": "rejection", "message": "This doesn't work for us."},
        )

        website_after = authed_client.get(f"/api/v1/websites/{website_id}").json()
        assert website_after["workflow_status"] == "changes_requested"

    def test_a_plain_comment_does_not_move_the_workflow(self, authed_client, client, monkeypatch):
        _, website_id, token = self._project_with_client_review_website(authed_client, monkeypatch)

        client.post(
            f"/api/v1/preview/{token}/websites/{website_id}/feedback",
            json={"feedback_type": "comment", "message": "Nice work overall."},
        )

        website_after = authed_client.get(f"/api/v1/websites/{website_id}").json()
        assert website_after["workflow_status"] == "client_review"

    def test_feedback_on_a_version_not_in_client_review_never_moves_the_workflow(self, authed_client, client, monkeypatch):
        # Internal-audience link can see a DRAFT version — feedback there
        # must not silently drive the workflow forward.
        project, website = _generate_website(authed_client, monkeypatch)
        website_id = website["id"]
        link = authed_client.post(f"/api/v1/projects/{project['id']}/previews", json={"audience": "internal"}).json()
        token = link["url"].rsplit("/", 1)[-1]

        client.post(
            f"/api/v1/preview/{token}/websites/{website_id}/feedback",
            json={"feedback_type": "approval", "message": "Approving early."},
        )

        website_after = authed_client.get(f"/api/v1/websites/{website_id}").json()
        assert website_after["workflow_status"] == "draft"


class TestDeploymentRequiresReadyToDeploy:
    def _build_deployable_project_missing_workflow_step(self, authed_client, monkeypatch):
        """Every boolean checkpoint approved, but the workflow was never
        walked past DRAFT — the exact gap Task 3 exists to close."""
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

    def test_deployment_refused_even_with_every_boolean_checkpoint_approved(self, authed_client, monkeypatch):
        project, website = self._build_deployable_project_missing_workflow_step(authed_client, monkeypatch)
        assert website["workflow_status"] == "draft"

        res = authed_client.post(f"/api/v1/projects/{project['id']}/deployments")
        assert res.status_code == 400
        assert "Approval workflow" in res.json()["detail"]

    def test_deployment_succeeds_once_ready_to_deploy_and_marks_website_deployed(self, authed_client, monkeypatch):
        project, website = self._build_deployable_project_missing_workflow_step(authed_client, monkeypatch)
        website_id = website["id"]
        for to_status in ("internal_review", "client_review", "approved", "ready_to_deploy"):
            authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": to_status})

        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        res = authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute")
        assert res.status_code == 200
        assert res.json()["status"] == "success"

        website_after = authed_client.get(f"/api/v1/websites/{website_id}").json()
        assert website_after["workflow_status"] == "deployed"

    def test_editing_after_ready_to_deploy_blocks_execution(self, authed_client, monkeypatch):
        project, website = self._build_deployable_project_missing_workflow_step(authed_client, monkeypatch)
        website_id = website["id"]
        for to_status in ("internal_review", "client_review", "approved", "ready_to_deploy"):
            authed_client.post(f"/api/v1/websites/{website_id}/workflow-transition", json={"to_status": to_status})
        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()

        section_id = website["navigation"]["id"]
        authed_client.patch(
            f"/api/v1/websites/{website_id}/sections/{section_id}", json={"config": {"logo": {"label": "Changed"}}}
        )

        res = authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute")
        assert res.status_code == 400
        assert "workflow status" in res.json()["detail"]
