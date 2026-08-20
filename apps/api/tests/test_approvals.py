"""
Integration tests for the human approval workflow: the aggregation
endpoint (modules/approvals/) plus the full pipeline it reports on —
client brief -> creative direction -> sitemap -> generated website ->
QA -> client review -> final deployment. Exercises the real endpoints
end to end rather than the individual gating functions in isolation
(those get focused coverage in test_websites.py, test_qa_reports.py,
test_deployments.py).
"""

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
        {
            "title": "Contact", "slug": "contact", "page_type": "contact", "parent_slug": None,
            "nav_placement": "primary_nav", "purpose": "Every remaining way to reach the business.",
            "primary_cta": "Send message", "secondary_cta": None,
            "key_sections": ["Contact form"], "required_content": [], "required_functionality": [],
        },
    ],
}

_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "contact_email": "hello@riversideplumbing.com.au",
}


def _patch_creative_director(monkeypatch):
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )


def _patch_sitemap_agent(monkeypatch):
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(SITEMAP_LLM_OUTPUT))


def _create_project_without_lead(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post("/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}).json()
    return authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}).json()


def _find(checkpoints, stage):
    return next(c for c in checkpoints if c["stage"] == stage)


class TestApprovalStatusEndpoint:
    def test_requires_auth(self, client):
        res = client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/approvals")
        assert res.status_code == 401

    def test_unknown_project_404s(self, authed_client):
        res = authed_client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/approvals")
        assert res.status_code == 404

    def test_fresh_project_reports_every_checkpoint_unapproved_with_a_reason(self, authed_client):
        project = _create_project_without_lead(authed_client)
        res = authed_client.get(f"/api/v1/projects/{project['id']}/approvals")
        assert res.status_code == 200
        body = res.json()

        assert len(body["checkpoints"]) == 7
        assert [c["stage"] for c in body["checkpoints"]] == [
            "client_brief", "creative_direction", "sitemap", "generated_website", "qa", "client_review", "deployment",
        ]
        assert all(c["approved"] is False for c in body["checkpoints"])
        assert all(c["blocked_reason"] for c in body["checkpoints"])
        assert body["can_deploy"] is False
        assert len(body["missing_for_deployment"]) == 6


class TestPipelineProgression:
    def test_each_checkpoint_flips_true_only_once_actually_approved(self, authed_client, monkeypatch):
        _patch_creative_director(monkeypatch)
        _patch_sitemap_agent(monkeypatch)
        project = _create_project_without_lead(authed_client)
        project_id = project["id"]

        # Nothing approved yet.
        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "client_brief")["approved"] is False

        # 1. Client brief.
        authed_client.patch(f"/api/v1/projects/{project_id}/brief", json=_REAL_BRIEF)
        authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")
        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "client_brief")["approved"] is True
        assert _find(status["checkpoints"], "creative_direction")["approved"] is False

        # 2. Creative direction.
        cd = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions").json()
        authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "creative_direction")["approved"] is True
        assert _find(status["checkpoints"], "sitemap")["approved"] is False

        # 3. Sitemap.
        sitemap = authed_client.post(f"/api/v1/projects/{project_id}/sitemaps").json()
        authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "sitemap")["approved"] is True
        assert _find(status["checkpoints"], "generated_website")["approved"] is False
        assert status["can_deploy"] is False

        # 4. Generated website.
        website = authed_client.post(f"/api/v1/projects/{project_id}/websites").json()
        approve_res = authed_client.post(f"/api/v1/websites/{website['id']}/approve")
        assert approve_res.status_code == 200
        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "generated_website")["approved"] is True
        assert _find(status["checkpoints"], "qa")["approved"] is False

        # 5. QA.
        qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        approve_qa_res = authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")
        assert approve_qa_res.status_code == 200
        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "qa")["approved"] is True
        assert _find(status["checkpoints"], "client_review")["approved"] is False
        assert status["can_deploy"] is False

        # 6. Client review.
        client_approve_res = authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
        assert client_approve_res.status_code == 200
        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "client_review")["approved"] is True
        assert status["can_deploy"] is True
        assert status["missing_for_deployment"] == []

        # 7. Final deployment.
        deploy_res = authed_client.post(f"/api/v1/projects/{project_id}/deployments")
        assert deploy_res.status_code == 201
        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "deployment")["approved"] is True

    def test_editing_the_brief_after_later_stages_are_approved_reverts_only_the_brief_checkpoint(
        self, authed_client, monkeypatch
    ):
        _patch_creative_director(monkeypatch)
        _patch_sitemap_agent(monkeypatch)
        project = _create_project_without_lead(authed_client)
        project_id = project["id"]

        authed_client.patch(f"/api/v1/projects/{project_id}/brief", json=_REAL_BRIEF)
        authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")
        cd = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions").json()
        authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")

        # Edit the brief after creative direction is already approved.
        authed_client.patch(f"/api/v1/projects/{project_id}/brief", json={"business_description": "Updated description"})

        status = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
        assert _find(status["checkpoints"], "client_brief")["approved"] is False
        # Creative direction's own approval is untouched by a brief edit
        # — no cross-entity cascading invalidation, only within-entity.
        assert _find(status["checkpoints"], "creative_direction")["approved"] is True
