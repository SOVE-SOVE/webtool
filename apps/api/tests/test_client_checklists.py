"""
Client Setup & Delivery checklist (docs/05_DECISIONS.md): a persisted,
per-client checklist mixing automatic items (computed live from real
approval/build/QA/deployment signals, never cached) with manual ones,
seeded once on client/project creation and never duplicated.
"""

from app.modules.checklists import service as checklists_service
from app.modules.checklists import shared as checklists_shared

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

DEFAULT_PROJECT_TASK_COUNT = 9


def _patch_creative_director(monkeypatch):
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )


def _patch_sitemap_agent(monkeypatch):
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(SITEMAP_LLM_OUTPUT))


def _create_project_without_lead(authed_client, business_name="Riverside Plumbing"):
    client = authed_client.post(
        "/api/v1/clients", json={"business_name": business_name, "industry": "Plumbing"}
    ).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client["id"], "name": f"{business_name} website"}
    ).json()
    return client, project


def _checklist(authed_client, client_id):
    res = authed_client.get(f"/api/v1/clients/{client_id}/checklist")
    assert res.status_code == 200, res.text
    return res.json()


def _project_section(checklist, project_id):
    return next(p for p in checklist["projects"] if p["project_id"] == project_id)


def _item(section_or_checklist, title):
    items = section_or_checklist["items"] if "items" in section_or_checklist else section_or_checklist["client_items"]
    return next(i for i in items if i["title"] == title)


def _build_deployable_project(authed_client, monkeypatch, client, project):
    """Walks a project through every checkpoint (mirrors test_deployments.py's
    helper) so every automatic checklist signal has something real to read."""
    _patch_sitemap_agent(monkeypatch)
    _patch_creative_director(monkeypatch)
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

    for to_status in ("internal_review", "client_review", "approved", "ready_to_deploy"):
        res = authed_client.post(f"/api/v1/websites/{website['id']}/workflow-transition", json={"to_status": to_status})
        assert res.status_code == 200, res.text

    deployment = authed_client.post(f"/api/v1/projects/{project_id}/deployments").json()
    executed = authed_client.post(f"/api/v1/deployments/{deployment['id']}/execute").json()
    authed_client.post(f"/api/v1/deployments/{executed['id']}/verify")

    return cd, sitemap, website


class TestSeeding:
    def test_creating_client_directly_seeds_only_the_client_level_task(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        assert [i["title"] for i in checklist["client_items"]] == ["Confirm business and contact details"]
        assert checklist["projects"] == []

    def test_converting_a_lead_seeds_client_level_and_that_projects_defaults_once(self, authed_client):
        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()["id"]
        client = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id}).json()

        checklist = _checklist(authed_client, client["id"])
        assert len(checklist["client_items"]) == 1
        assert len(checklist["projects"]) == 1
        section = checklist["projects"][0]
        assert len(section["items"]) == DEFAULT_PROJECT_TASK_COUNT
        assert [i["title"] for i in section["items"]] == [
            "Confirm website scope",
            "Approve website direction",
            "Collect logo and approved images",
            "Approve website content",
            "Build first preview",
            "Review client feedback",
            "Complete final QA",
            "Approve launch",
            "Launch website",
        ]

    def test_initialising_twice_never_duplicates_rows(self, db_session, workspace):
        from app.modules.businesses.models import Business
        from app.modules.clients.models import Client

        business = Business(workspace_id=workspace.id, name="Direct Co")
        db_session.add(business)
        db_session.flush()
        client = Client(business_id=business.id)
        db_session.add(client)
        db_session.flush()

        checklists_service.initialise_client_checklist(db_session, client.id)
        checklists_service.initialise_client_checklist(db_session, client.id)
        db_session.commit()

        from app.modules.checklists.models import ClientChecklistItem

        rows = db_session.query(ClientChecklistItem).filter_by(client_id=client.id).all()
        assert len(rows) == 1

    def test_a_client_created_before_this_feature_existed_gets_backfilled_on_first_read(self, authed_client, db_session):
        """A Client/Project row created without going through either seed
        hook (e.g. one that predates this feature) must not be stuck
        showing a permanently empty checklist — the first GET backfills
        it, and that backfill is itself idempotent."""
        from app.modules.checklists.models import ClientChecklistItem

        client, project = _create_project_without_lead(authed_client)
        db_session.query(ClientChecklistItem).filter_by(client_id=client["id"]).delete()
        db_session.commit()

        checklist = _checklist(authed_client, client["id"])
        assert len(checklist["client_items"]) == 1
        section = _project_section(checklist, project["id"])
        assert len(section["items"]) == DEFAULT_PROJECT_TASK_COUNT

        # Reading again doesn't duplicate the backfilled rows.
        checklist_again = _checklist(authed_client, client["id"])
        assert len(checklist_again["client_items"]) == 1
        assert len(_project_section(checklist_again, project["id"])["items"]) == DEFAULT_PROJECT_TASK_COUNT

    def test_starting_another_project_seeds_only_that_projects_defaults(self, authed_client):
        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()["id"]
        client = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id}).json()
        first_project_id = authed_client.get("/api/v1/projects").json()[0]["id"]

        second_project = authed_client.post(
            "/api/v1/projects", json={"client_id": client["id"], "name": "Second website"}
        ).json()

        checklist = _checklist(authed_client, client["id"])
        assert len(checklist["client_items"]) == 1  # not duplicated
        assert len(checklist["projects"]) == 2
        first_section = _project_section(checklist, first_project_id)
        second_section = _project_section(checklist, second_project["id"])
        assert len(first_section["items"]) == DEFAULT_PROJECT_TASK_COUNT
        assert len(second_section["items"]) == DEFAULT_PROJECT_TASK_COUNT
        assert {i["id"] for i in first_section["items"]}.isdisjoint({i["id"] for i in second_section["items"]})


class TestAutomaticSignals:
    def test_website_scope_confirmed_tracks_client_brief_approval(self, authed_client):
        client, project = _create_project_without_lead(authed_client)
        checklist = _checklist(authed_client, client["id"])
        section = _project_section(checklist, project["id"])
        assert _item(section, "Confirm website scope")["status"] == "pending"

        authed_client.patch(f"/api/v1/projects/{project['id']}/brief", json=_REAL_BRIEF)
        authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")
        checklist = _checklist(authed_client, client["id"])
        section = _project_section(checklist, project["id"])
        item = _item(section, "Confirm website scope")
        assert item["status"] == "complete"
        assert item["completed_by"]["type"] == "system"
        assert item["link"] is not None

        # Editing an approved brief reverts its own approval — the
        # checklist item must reflect that live, not stay stuck complete.
        authed_client.patch(f"/api/v1/projects/{project['id']}/brief", json={"business_description": "Updated"})
        checklist = _checklist(authed_client, client["id"])
        section = _project_section(checklist, project["id"])
        assert _item(section, "Confirm website scope")["status"] == "pending"

    def test_direction_approved_tracks_creative_direction_approval(self, authed_client, monkeypatch):
        _patch_creative_director(monkeypatch)
        client, project = _create_project_without_lead(authed_client)
        cd = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()

        checklist = _checklist(authed_client, client["id"])
        assert _item(_project_section(checklist, project["id"]), "Approve website direction")["status"] == "pending"

        authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
        checklist = _checklist(authed_client, client["id"])
        assert _item(_project_section(checklist, project["id"]), "Approve website direction")["status"] == "complete"

        authed_client.patch(f"/api/v1/creative-directions/{cd['id']}", json={"creative_concept": "Revised concept."})
        checklist = _checklist(authed_client, client["id"])
        assert _item(_project_section(checklist, project["id"]), "Approve website direction")["status"] == "pending"

    def test_content_approved_tracks_sitemap_approval(self, authed_client, monkeypatch):
        _patch_sitemap_agent(monkeypatch)
        client, project = _create_project_without_lead(authed_client)
        sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()

        checklist = _checklist(authed_client, client["id"])
        assert _item(_project_section(checklist, project["id"]), "Approve website content")["status"] == "pending"

        authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
        checklist = _checklist(authed_client, client["id"])
        assert _item(_project_section(checklist, project["id"]), "Approve website content")["status"] == "complete"

    def test_preview_built_tracks_website_existence(self, authed_client, monkeypatch):
        _patch_sitemap_agent(monkeypatch)
        _patch_creative_director(monkeypatch)
        client, project = _create_project_without_lead(authed_client)

        checklist = _checklist(authed_client, client["id"])
        assert _item(_project_section(checklist, project["id"]), "Build first preview")["status"] == "pending"

        authed_client.patch(f"/api/v1/projects/{project['id']}/brief", json=_REAL_BRIEF)
        authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")
        cd = authed_client.post(f"/api/v1/projects/{project['id']}/creative-directions").json()
        authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
        sitemap = authed_client.post(f"/api/v1/projects/{project['id']}/sitemaps").json()
        authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")

        res = authed_client.post(f"/api/v1/projects/{project['id']}/websites")
        assert res.status_code == 201, res.text
        checklist = _checklist(authed_client, client["id"])
        assert _item(_project_section(checklist, project["id"]), "Build first preview")["status"] == "complete"

    def test_qa_complete_and_launch_approved_and_website_launched(self, authed_client, monkeypatch):
        client, project = _create_project_without_lead(authed_client)
        _build_deployable_project(authed_client, monkeypatch, client, project)

        checklist = _checklist(authed_client, client["id"])
        section = _project_section(checklist, project["id"])
        assert _item(section, "Complete final QA")["status"] == "complete"
        assert _item(section, "Approve launch")["status"] == "complete"
        assert _item(section, "Launch website")["status"] == "complete"


class TestManualTasksAndNotRequired:
    def test_manual_toggle_rejected_on_an_automatic_item(self, authed_client):
        client, project = _create_project_without_lead(authed_client)
        checklist = _checklist(authed_client, client["id"])
        item = _item(_project_section(checklist, project["id"]), "Confirm website scope")

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "complete"})
        assert res.status_code == 400

    def test_manual_task_can_be_completed_and_reopened(self, authed_client):
        client, project = _create_project_without_lead(authed_client)
        checklist = _checklist(authed_client, client["id"])
        item = _item(_project_section(checklist, project["id"]), "Collect logo and approved images")

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "complete"})
        assert res.status_code == 200
        section = _project_section(res.json(), project["id"])
        completed = _item(section, "Collect logo and approved images")
        assert completed["status"] == "complete"
        assert completed["completed_at"] is not None
        assert completed["completed_by"]["type"] == "user"

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "pending"})
        reopened = _item(_project_section(res.json(), project["id"]), "Collect logo and approved images")
        assert reopened["status"] == "pending"
        assert reopened["completed_at"] is None

    def test_not_required_excluded_from_progress_numerator_and_denominator(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")
        assert checklist["client_progress"]["required"] == {"completed": 0, "total": 1, "pct": 0}

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "not_required"})
        assert res.status_code == 200
        assert res.json()["client_progress"]["required"] == {"completed": 0, "total": 0, "pct": None}

    def test_remove_custom_task_but_not_a_default(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()

        add_res = authed_client.post(
            f"/api/v1/clients/{client['id']}/checklist/items", json={"title": "Sign contract"}
        )
        assert add_res.status_code == 201
        custom_item = _item(add_res.json(), "Sign contract")

        default_item = _item(add_res.json(), "Confirm business and contact details")
        reject = authed_client.delete(f"/api/v1/clients/checklist/items/{default_item['id']}")
        assert reject.status_code == 400

        removed = authed_client.delete(f"/api/v1/clients/checklist/items/{custom_item['id']}")
        assert removed.status_code == 200
        assert all(i["title"] != "Sign contract" for i in removed.json()["client_items"])

    def test_reorder_only_affects_targeted_items(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        authed_client.post(f"/api/v1/clients/{client['id']}/checklist/items", json={"title": "Sign contract"})
        checklist = _checklist(authed_client, client["id"])
        first, second = checklist["client_items"]

        res = authed_client.post(
            f"/api/v1/clients/{client['id']}/checklist/items/reorder",
            json={"items": [{"id": first["id"], "order_index": second["order_index"]}, {"id": second["id"], "order_index": first["order_index"]}]},
        )
        assert res.status_code == 200
        reordered = sorted(res.json()["client_items"], key=lambda i: i["order_index"])
        assert reordered[0]["id"] == second["id"]
        assert reordered[1]["id"] == first["id"]


class TestEmptyProgress:
    def test_compute_progress_of_an_empty_list_reports_none_pct(self):
        split = checklists_shared.compute_progress_split([])
        assert split.required.total == 0
        assert split.required.pct is None
        assert split.optional.total == 0
        assert split.optional.pct is None

    def test_compute_progress_when_every_item_is_not_required(self):
        split = checklists_shared.compute_progress_split([("not_required", True), ("not_required", False)])
        assert split.required.total == 0
        assert split.required.pct is None
        assert split.optional.total == 0
        assert split.optional.pct is None


class TestMultipleProjectsNeverCrossContaminate:
    def test_completing_one_projects_manual_tasks_never_flips_the_other(self, authed_client):
        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()["id"]
        client = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id}).json()
        first_project_id = authed_client.get("/api/v1/projects").json()[0]["id"]
        second_project = authed_client.post(
            "/api/v1/projects", json={"client_id": client["id"], "name": "Second website"}
        ).json()

        checklist = _checklist(authed_client, client["id"])
        first_section = _project_section(checklist, first_project_id)
        for title in ("Collect logo and approved images", "Review client feedback"):
            item = _item(first_section, title)
            authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "complete"})

        checklist = _checklist(authed_client, client["id"])
        first_section = _project_section(checklist, first_project_id)
        second_section = _project_section(checklist, second_project["id"])
        assert first_section["progress"]["required"]["completed"] == 2
        assert second_section["progress"]["required"]["completed"] == 0


class TestWorkspaceScoping:
    def test_checklist_endpoints_are_workspace_scoped(self, authed_client, other_authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()

        assert other_authed_client.get(f"/api/v1/clients/{client['id']}/checklist").status_code == 404
        assert (
            other_authed_client.post(f"/api/v1/clients/{client['id']}/checklist/items", json={"title": "x"}).status_code
            == 404
        )

        checklist = _checklist(authed_client, client["id"])
        item_id = checklist["client_items"][0]["id"]
        assert other_authed_client.patch(f"/api/v1/clients/checklist/items/{item_id}", json={"status": "complete"}).status_code == 404
        assert other_authed_client.delete(f"/api/v1/clients/checklist/items/{item_id}").status_code == 404


class TestAssignment:
    def test_assign_reassign_and_unassign_a_task(self, authed_client, member_user):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}", json={"assigned_user_id": str(member_user.id)}
        )
        assert res.status_code == 200
        assigned = _item(res.json(), "Confirm business and contact details")
        assert assigned["assigned_user_id"] == str(member_user.id)
        assert assigned["assigned_user_name"] == member_user.name

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "client_checklist_item", "entity_id": item["id"]}
        ).json()
        assert any(a["action"] == "assigned" and a["summary"] == "Reassigned" for a in activity)

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"assigned_user_id": None})
        unassigned = _item(res.json(), "Confirm business and contact details")
        assert unassigned["assigned_user_id"] is None
        assert unassigned["assigned_user_name"] is None

    def test_omitting_assigned_user_id_leaves_assignment_untouched(self, authed_client, member_user):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")
        authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"assigned_user_id": str(member_user.id)})

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"title": "Confirm details"})
        still_assigned = _item(res.json(), "Confirm details")
        assert still_assigned["assigned_user_id"] == str(member_user.id)

    def test_cannot_assign_a_user_from_another_workspace(self, authed_client, other_admin_user):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}", json={"assigned_user_id": str(other_admin_user.id)}
        )
        assert res.status_code == 404

    def test_custom_task_can_be_created_pre_assigned(self, authed_client, member_user):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        res = authed_client.post(
            f"/api/v1/clients/{client['id']}/checklist/items",
            json={"title": "Call the client", "assigned_user_id": str(member_user.id)},
        )
        assert res.status_code == 201
        item = _item(res.json(), "Call the client")
        assert item["assigned_user_id"] == str(member_user.id)


class TestBlocked:
    def test_blocking_requires_a_reason(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "blocked"})
        assert res.status_code == 400

    def test_block_and_unblock_preserves_notes_and_history(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}",
            json={"status": "blocked", "blocked_reason": "Waiting for approved business photos."},
        )
        assert res.status_code == 200
        blocked = _item(res.json(), "Confirm business and contact details")
        assert blocked["status"] == "blocked"
        assert blocked["blocked_reason"] == "Waiting for approved business photos."

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "pending"})
        unblocked = _item(res.json(), "Confirm business and contact details")
        assert unblocked["status"] == "pending"
        assert unblocked["blocked_reason"] is None

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "client_checklist_item", "entity_id": item["id"]}
        ).json()
        actions = [a["action"] for a in activity]
        assert "blocked" in actions
        assert "unblocked" in actions

    def test_cannot_block_a_complete_task(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")
        authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "complete"})

        res = authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "blocked", "blocked_reason": "x"}
        )
        assert res.status_code == 400

    def test_blocked_items_count_in_total_but_not_completed(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "blocked", "blocked_reason": "x"}
        )
        progress = res.json()["client_progress"]["required"]
        assert progress == {"completed": 0, "total": 1, "pct": 0}

    def test_blocking_an_automatic_item_overrides_its_live_signal(self, authed_client):
        client, project = _create_project_without_lead(authed_client)
        checklist = _checklist(authed_client, client["id"])
        section = _project_section(checklist, project["id"])
        item = _item(section, "Build first preview")
        assert item["status"] == "pending"

        res = authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}",
            json={"status": "blocked", "blocked_reason": "Waiting on brand assets before we can generate a preview."},
        )
        assert res.status_code == 200
        blocked = _item(_project_section(res.json(), project["id"]), "Build first preview")
        assert blocked["status"] == "blocked"
        assert blocked["blocked_reason"]

        # Clearing the override lets the live (still-pending) signal show through again.
        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "pending"})
        cleared = _item(_project_section(res.json(), project["id"]), "Build first preview")
        assert cleared["status"] == "pending"
        assert cleared["blocked_reason"] is None


class TestRequiredOptional:
    def test_custom_tasks_default_to_optional_defaults_stay_required(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        add_res = authed_client.post(f"/api/v1/clients/{client['id']}/checklist/items", json={"title": "Personal reminder"})
        checklist = add_res.json()
        custom = _item(checklist, "Personal reminder")
        default = _item(checklist, "Confirm business and contact details")
        assert custom["is_required"] is False
        assert default["is_required"] is True

    def test_required_and_optional_progress_reported_separately(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        add_res = authed_client.post(f"/api/v1/clients/{client['id']}/checklist/items", json={"title": "Personal reminder"})
        custom = _item(add_res.json(), "Personal reminder")

        res = authed_client.patch(f"/api/v1/clients/checklist/items/{custom['id']}", json={"status": "complete"})
        progress = res.json()["client_progress"]
        assert progress["required"] == {"completed": 0, "total": 1, "pct": 0}
        assert progress["optional"] == {"completed": 1, "total": 1, "pct": 100}


class TestNextAction:
    def test_next_action_picks_the_first_actionable_required_task_in_order(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        next_action = checklist["client_next_action"]
        assert next_action["kind"] == "task"
        assert next_action["item"]["title"] == "Confirm business and contact details"

    def test_next_action_surfaces_blocking_reasons_when_every_required_task_is_blocked(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}",
            json={"status": "blocked", "blocked_reason": "Waiting on the business owner to confirm details."},
        )
        next_action = res.json()["client_next_action"]
        assert next_action["kind"] == "blocked"
        assert len(next_action["items"]) == 1
        assert next_action["items"][0]["blocked_reason"] == "Waiting on the business owner to confirm details."

    def test_next_action_falls_back_to_optional_when_no_required_actionable_remain(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        required_item = _item(checklist, "Confirm business and contact details")
        authed_client.patch(f"/api/v1/clients/checklist/items/{required_item['id']}", json={"status": "complete"})

        add_res = authed_client.post(f"/api/v1/clients/{client['id']}/checklist/items", json={"title": "Nice to have"})
        checklist = add_res.json()

        next_action = checklist["client_next_action"]
        assert next_action["kind"] == "task"
        assert next_action["item"]["title"] == "Nice to have"

    def test_next_action_is_done_when_nothing_actionable_remains(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")
        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "complete"})
        assert res.json()["client_next_action"]["kind"] == "done"


class TestCompletionNotes:
    def test_completing_with_a_note_records_it_without_requiring_one(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")

        # A plain tick with no note works exactly as before.
        res = authed_client.patch(f"/api/v1/clients/checklist/items/{item['id']}", json={"status": "complete"})
        assert res.status_code == 200

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "client_checklist_item", "entity_id": item["id"]}
        ).json()
        assert any(a["action"] == "completed" and "—" not in a["summary"] for a in activity)

    def test_completing_with_a_note_includes_it_in_history(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        checklist = _checklist(authed_client, client["id"])
        item = _item(checklist, "Confirm business and contact details")

        authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}",
            json={"status": "pending"},
        )
        res = authed_client.patch(
            f"/api/v1/clients/checklist/items/{item['id']}",
            json={"status": "complete", "note": "Confirmed by phone with the owner."},
        )
        assert res.status_code == 200

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "client_checklist_item", "entity_id": item["id"]}
        ).json()
        assert any("Confirmed by phone with the owner." in (a["summary"] or "") for a in activity)


class TestLeadClientIdAndSummaries:
    def test_lead_client_id_is_null_until_converted(self, authed_client):
        lead = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()
        assert lead["client_id"] is None

        lead_id = lead["id"]
        client = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id}).json()

        lead_after = authed_client.get(f"/api/v1/leads/{lead_id}").json()
        assert lead_after["client_id"] == client["id"]

    def test_checklist_summaries_reports_one_entry_per_client_workspace_scoped(self, authed_client, other_authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        other_authed_client.post("/api/v1/clients", json={"business_name": "Other Workspace Co"})

        summaries = authed_client.get("/api/v1/clients/checklist-summaries").json()
        assert len(summaries) == 1
        assert summaries[0]["client_id"] == client["id"]
        assert summaries[0]["total"] == 1
        assert summaries[0]["completed"] == 0
        assert summaries[0]["pct"] == 0
