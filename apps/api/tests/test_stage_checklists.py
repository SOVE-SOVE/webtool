"""
Stage-specific checklists (docs/05_DECISIONS.md): one compact "Stage
Checklist" panel per pre-Client stage (Discovery review, Lead, Planning,
Project), reusing the Client Setup & Delivery checklist's shape without
touching that already-shipped table. Covers idempotent lazy-seeding per
owner type, automatic items backed by real signals, the read-time
"needs_review" staleness flip for manual review items, isolation between
owners, zero side effects from ticking, and persistence across pipeline
advancement.
"""

from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.stage_checklists.models import StageChecklistItem

DEFAULT_DISCOVERY_TITLES = [
    "Confirm business identity and location",
    "Review website/social presence",
    "Review suitability as a prospect",
]
DEFAULT_LEAD_TITLES = [
    "Confirm business and contact details",
    "Review available research",
    "Confirm prospect suitability",
    "Ready to start Planning",
]
DEFAULT_PLANNING_TITLES = [
    "Review website audit or new-website research",
    "Review Google Review Insights, where available",
    "Review improvement recommendations",
    "Select website structure and direction",
    "Review content and asset requirements",
    "Approve the build brief",
]
DEFAULT_PROJECT_TITLES = [
    "Review build inputs",
    "Generate first preview",
    "Review desktop and mobile",
    "Complete revisions",
    "Complete QA",
    "Approve the website for presentation or launch",
]


def _make_search(db_session, workspace, **overrides) -> DiscoverySearch:
    defaults = dict(workspace_id=workspace.id, industry="Plumbing", provider="manual")
    defaults.update(overrides)
    search = DiscoverySearch(**defaults)
    db_session.add(search)
    db_session.commit()
    db_session.refresh(search)
    return search


def _make_discovered_business(db_session, search, **overrides) -> DiscoveredBusiness:
    defaults = dict(
        discovery_search_id=search.id,
        name="Gold Coast Plumbing Co",
        website_url="https://gcplumbing.example",
        source_provider="manual",
        dedup_key="gold coast plumbing co||",
    )
    defaults.update(overrides)
    business = DiscoveredBusiness(**defaults)
    db_session.add(business)
    db_session.commit()
    db_session.refresh(business)
    return business


def _create_lead(authed_client, name="Hilltop Roofing"):
    return authed_client.post("/api/v1/leads", json={"business_name": name}).json()


def _start_planning(authed_client, lead):
    return authed_client.post(f"/api/v1/leads/{lead['id']}/planning").json()


def _item(checklist, title):
    return next(i for i in checklist["items"] if i["title"] == title)


def _complete(authed_client, item_id):
    res = authed_client.patch(f"/api/v1/stage-checklist-items/{item_id}", json={"status": "complete"})
    assert res.status_code == 200, res.text
    return res.json()


class TestSeedingIsIdempotentPerStage:
    def test_discovery_checklist_seeds_once(self, authed_client, db_session, workspace):
        search = _make_search(db_session, workspace)
        business = _make_discovered_business(db_session, search)

        first = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/checklist").json()
        second = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/checklist").json()
        assert [i["title"] for i in first["items"]] == DEFAULT_DISCOVERY_TITLES
        assert first == second
        assert db_session.query(StageChecklistItem).filter_by(discovered_business_id=business.id).count() == 3

    def test_lead_checklist_seeds_once(self, authed_client):
        lead = _create_lead(authed_client)
        first = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        second = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        assert [i["title"] for i in first["items"]] == DEFAULT_LEAD_TITLES
        assert first == second

    def test_planning_checklist_seeds_once(self, authed_client):
        lead = _create_lead(authed_client)
        planning = _start_planning(authed_client, lead)
        first = authed_client.get(f"/api/v1/planning/{planning['id']}/checklist").json()
        second = authed_client.get(f"/api/v1/planning/{planning['id']}/checklist").json()
        assert [i["title"] for i in first["items"]] == DEFAULT_PLANNING_TITLES
        assert first == second

    def test_project_stage_checklist_seeds_once_for_a_prospect_project(self, authed_client):
        lead = _create_lead(authed_client)
        project = authed_client.post("/api/v1/projects", json={"lead_id": lead["id"], "name": "Hilltop Roofing Website"}).json()
        first = authed_client.get(f"/api/v1/projects/{project['id']}/checklist").json()
        second = authed_client.get(f"/api/v1/projects/{project['id']}/checklist").json()
        assert [i["title"] for i in first["items"]] == DEFAULT_PROJECT_TITLES
        assert first == second

    def test_project_stage_checklist_seeds_for_a_client_owned_project_too(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        project = authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": "Coastal Cafe Website"}).json()
        checklist = authed_client.get(f"/api/v1/projects/{project['id']}/checklist").json()
        assert [i["title"] for i in checklist["items"]] == DEFAULT_PROJECT_TITLES

    def test_unknown_owner_ids_404(self, authed_client):
        import uuid

        assert authed_client.get(f"/api/v1/leads/{uuid.uuid4()}/checklist").status_code == 404
        assert authed_client.get(f"/api/v1/planning/{uuid.uuid4()}/checklist").status_code == 404
        assert authed_client.get(f"/api/v1/projects/{uuid.uuid4()}/checklist").status_code == 404
        assert authed_client.get(f"/api/v1/discovered-businesses/{uuid.uuid4()}/checklist").status_code == 404


class TestAutomaticItems:
    def test_approving_the_build_brief_completes_that_item_automatically(self, authed_client, monkeypatch):
        from tests.test_planning import _start_and_analyse

        lead = _create_lead(authed_client, "Coastal Cafe")
        result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

        checklist = authed_client.get(f"/api/v1/planning/{result['id']}/checklist").json()
        assert _item(checklist, "Approve the build brief")["status"] == "pending"

        authed_client.post(f"/api/v1/planning/{result['id']}/build-brief/approve")

        checklist = authed_client.get(f"/api/v1/planning/{result['id']}/checklist").json()
        item = _item(checklist, "Approve the build brief")
        assert item["status"] == "complete"
        assert item["completed_by"]["type"] == "system"

    def test_automatic_project_items_reuse_the_real_delivery_signals(self, authed_client, monkeypatch):
        monkeypatch.setattr(
            "app.agents.creative_director.generate_structured",
            lambda **kwargs: {
                "facts": ["x"], "assumptions": [], "creative_concept": "x", "visual_direction": "x",
                "brand_personality": ["x"], "colour_direction": "x", "typography_direction": "x",
                "image_direction": "x", "layout_direction": "x", "ux_direction": "x", "tone_of_voice": "x",
                "visual_hierarchy": "x", "cta_strategy": "x", "things_to_avoid": [], "references_inspiration": [],
            },
        )
        monkeypatch.setattr(
            "app.agents.sitemap.generate_structured",
            lambda **kwargs: {
                "overview": "x",
                "pages": [
                    {
                        "title": "Home", "slug": "", "page_type": "home", "parent_slug": None,
                        "nav_placement": "primary_nav", "purpose": "x", "primary_cta": "Call",
                        "secondary_cta": None, "key_sections": [], "required_content": [], "required_functionality": [],
                    }
                ],
            },
        )
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        project = authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": "Coastal Cafe Website"}).json()
        project_id = project["id"]

        checklist = authed_client.get(f"/api/v1/projects/{project_id}/checklist").json()
        assert _item(checklist, "Generate first preview")["status"] == "pending"
        assert _item(checklist, "Complete QA")["status"] == "pending"
        assert _item(checklist, "Approve the website for presentation or launch")["status"] == "pending"

        authed_client.patch(
            f"/api/v1/projects/{project_id}/brief",
            json={"business_description": "x", "contact_email": "hello@coastalcafe.example"},
        )
        authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")
        cd = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions").json()
        authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
        sitemap = authed_client.post(f"/api/v1/projects/{project_id}/sitemaps").json()
        authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")

        website = authed_client.post(f"/api/v1/projects/{project_id}/websites").json()
        checklist = authed_client.get(f"/api/v1/projects/{project_id}/checklist").json()
        assert _item(checklist, "Generate first preview")["status"] == "complete"

        authed_client.post(f"/api/v1/websites/{website['id']}/approve")
        qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
        authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")
        checklist = authed_client.get(f"/api/v1/projects/{project_id}/checklist").json()
        assert _item(checklist, "Complete QA")["status"] == "complete"

        authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
        checklist = authed_client.get(f"/api/v1/projects/{project_id}/checklist").json()
        assert _item(checklist, "Approve the website for presentation or launch")["status"] == "complete"

    def test_automatic_item_cannot_be_toggled_directly(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        project = authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": "Coastal Cafe Website"}).json()
        checklist = authed_client.get(f"/api/v1/projects/{project['id']}/checklist").json()
        item = _item(checklist, "Generate first preview")

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "complete"})
        assert res.status_code == 400


class TestNeedsReview:
    def test_completing_a_manual_review_item_then_regenerating_its_source_flips_it_to_needs_review(self, authed_client, monkeypatch):
        from tests.test_planning import _start_and_analyse

        lead = _create_lead(authed_client, "Coastal Cafe")
        result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

        checklist = authed_client.get(f"/api/v1/planning/{result['id']}/checklist").json()
        item = _item(checklist, "Review website audit or new-website research")
        assert item["status"] == "pending"

        _complete(authed_client, item["id"])
        checklist = authed_client.get(f"/api/v1/planning/{result['id']}/checklist").json()
        assert _item(checklist, "Review website audit or new-website research")["status"] == "complete"

        # Re-analysing bumps analysed_at forward — the underlying evidence
        # this review task was reviewing has changed since it was ticked.
        _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
        checklist = authed_client.get(f"/api/v1/planning/{result['id']}/checklist").json()
        item = _item(checklist, "Review website audit or new-website research")
        assert item["status"] == "needs_review"
        assert item["needs_review_reason"]

        # Re-ticking complete clears it.
        _complete(authed_client, item["id"])
        checklist = authed_client.get(f"/api/v1/planning/{result['id']}/checklist").json()
        assert _item(checklist, "Review website audit or new-website research")["status"] == "complete"


class TestNotRequiredExcludedFromProgress:
    def test_not_required_items_excluded_from_progress_math(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        assert checklist["progress"]["required"] == {"completed": 0, "total": 4, "pct": 0}

        item = _item(checklist, "Confirm prospect suitability")
        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "not_required"})
        checklist = res.json()
        assert checklist["progress"]["required"]["total"] == 3


class TestCustomTasks:
    def test_add_reorder_remove_custom_task(self, authed_client):
        lead = _create_lead(authed_client)
        authed_client.get(f"/api/v1/leads/{lead['id']}/checklist")  # triggers lazy-seed of the defaults
        add_res = authed_client.post(f"/api/v1/leads/{lead['id']}/checklist/items", json={"title": "Call the referrer back"})
        assert add_res.status_code == 201
        checklist = add_res.json()
        custom = _item(checklist, "Call the referrer back")
        assert custom["is_default"] is False
        assert custom["order_index"] == len(DEFAULT_LEAD_TITLES)

        # Default tasks cannot be removed.
        default_item = _item(checklist, DEFAULT_LEAD_TITLES[0])
        res = authed_client.delete(f"/api/v1/stage-checklist-items/{default_item['id']}")
        assert res.status_code == 400

        res = authed_client.delete(f"/api/v1/stage-checklist-items/{custom['id']}")
        assert res.status_code == 200
        assert all(i["title"] != "Call the referrer back" for i in res.json()["items"])

    def test_reorder_swaps_two_items(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        a, b = checklist["items"][0], checklist["items"][1]
        res = authed_client.post(
            f"/api/v1/leads/{lead['id']}/checklist/items/reorder",
            json={"items": [{"id": a["id"], "order_index": b["order_index"]}, {"id": b["id"], "order_index": a["order_index"]}]},
        )
        reordered = res.json()["items"]
        assert reordered[0]["title"] == b["title"]
        assert reordered[1]["title"] == a["title"]


class TestIsolationAndNoSideEffects:
    def test_two_leads_checklists_never_cross_contaminate(self, authed_client):
        lead_a = _create_lead(authed_client, "Hilltop Roofing")
        lead_b = _create_lead(authed_client, "Coastal Cafe")

        checklist_a = authed_client.get(f"/api/v1/leads/{lead_a['id']}/checklist").json()
        item_a = _item(checklist_a, "Confirm business and contact details")
        _complete(authed_client, item_a["id"])

        checklist_b = authed_client.get(f"/api/v1/leads/{lead_b['id']}/checklist").json()
        assert _item(checklist_b, "Confirm business and contact details")["status"] == "pending"

    def test_ticking_a_stage_checklist_item_never_changes_the_owning_record(self, authed_client):
        lead = _create_lead(authed_client)
        lead_before = authed_client.get(f"/api/v1/leads/{lead['id']}").json()

        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Ready to start Planning")
        _complete(authed_client, item["id"])

        lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
        assert lead_after["status"] == lead_before["status"]
        assert lead_after["planning_id"] is None

    def test_checklists_are_workspace_scoped(self, authed_client, other_authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")

        assert other_authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").status_code == 404
        assert other_authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "complete"}).status_code == 404


class TestPersistenceAcrossPipelineAdvancement:
    def test_lead_checklist_survives_planning_prospect_project_and_conversion(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")
        _complete(authed_client, item["id"])

        _start_planning(authed_client, lead)
        authed_client.post("/api/v1/projects", json={"lead_id": lead["id"], "name": "Hilltop Roofing Website"})
        authed_client.post("/api/v1/clients", json={"from_lead_id": lead["id"]})

        checklist_after = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        assert _item(checklist_after, "Confirm business and contact details")["status"] == "complete"

    def test_discovery_checklist_survives_import_to_lead(self, authed_client, db_session, workspace):
        search = _make_search(db_session, workspace)
        business = _make_discovered_business(db_session, search)
        checklist = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/checklist").json()
        item = _item(checklist, "Confirm business identity and location")
        _complete(authed_client, item["id"])

        authed_client.post(f"/api/v1/discovered-businesses/{business.id}/approve")

        checklist_after = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/checklist").json()
        assert _item(checklist_after, "Confirm business identity and location")["status"] == "complete"


class TestAssignment:
    def test_assign_reassign_and_unassign_a_task(self, authed_client, member_user):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"assigned_user_id": str(member_user.id)})
        assert res.status_code == 200
        assigned = _item(res.json(), "Confirm business and contact details")
        assert assigned["assigned_user_id"] == str(member_user.id)
        assert assigned["assigned_user_name"] == member_user.name

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "stage_checklist_item", "entity_id": item["id"]}
        ).json()
        assert any(a["action"] == "assigned" and a["summary"] == "Reassigned" for a in activity)

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"assigned_user_id": None})
        unassigned = _item(res.json(), "Confirm business and contact details")
        assert unassigned["assigned_user_id"] is None

    def test_cannot_assign_a_user_from_another_workspace(self, authed_client, other_admin_user):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/stage-checklist-items/{item['id']}", json={"assigned_user_id": str(other_admin_user.id)}
        )
        assert res.status_code == 404


class TestBlocked:
    def test_blocking_requires_a_reason(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "blocked"})
        assert res.status_code == 400

    def test_block_and_unblock_preserves_history(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/stage-checklist-items/{item['id']}",
            json={"status": "blocked", "blocked_reason": "Waiting for approved business photos."},
        )
        assert res.status_code == 200
        blocked = _item(res.json(), "Confirm business and contact details")
        assert blocked["status"] == "blocked"
        assert blocked["blocked_reason"] == "Waiting for approved business photos."

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "pending"})
        unblocked = _item(res.json(), "Confirm business and contact details")
        assert unblocked["status"] == "pending"
        assert unblocked["blocked_reason"] is None

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "stage_checklist_item", "entity_id": item["id"]}
        ).json()
        actions = [a["action"] for a in activity]
        assert "blocked" in actions
        assert "unblocked" in actions

    def test_cannot_block_a_complete_task(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")
        _complete(authed_client, item["id"])

        res = authed_client.patch(
            f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "blocked", "blocked_reason": "x"}
        )
        assert res.status_code == 400

    def test_blocked_items_count_in_total_but_not_completed(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "blocked", "blocked_reason": "x"}
        )
        assert res.json()["progress"]["required"]["total"] == 4
        assert res.json()["progress"]["required"]["completed"] == 0

    def test_blocking_an_automatic_item_overrides_its_live_signal(self, authed_client):
        client = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
        project = authed_client.post("/api/v1/projects", json={"client_id": client["id"], "name": "Coastal Cafe Website"}).json()
        checklist = authed_client.get(f"/api/v1/projects/{project['id']}/checklist").json()
        item = _item(checklist, "Generate first preview")
        assert item["status"] == "pending"

        res = authed_client.patch(
            f"/api/v1/stage-checklist-items/{item['id']}",
            json={"status": "blocked", "blocked_reason": "Waiting on brand assets."},
        )
        assert res.status_code == 200
        blocked = _item(res.json(), "Generate first preview")
        assert blocked["status"] == "blocked"

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "pending"})
        cleared = _item(res.json(), "Generate first preview")
        assert cleared["status"] == "pending"
        assert cleared["blocked_reason"] is None


class TestRequiredOptional:
    def test_custom_tasks_default_to_optional_defaults_stay_required(self, authed_client):
        lead = _create_lead(authed_client)
        authed_client.get(f"/api/v1/leads/{lead['id']}/checklist")
        add_res = authed_client.post(f"/api/v1/leads/{lead['id']}/checklist/items", json={"title": "Personal reminder"})
        checklist = add_res.json()
        custom = _item(checklist, "Personal reminder")
        default = _item(checklist, "Confirm business and contact details")
        assert custom["is_required"] is False
        assert default["is_required"] is True

    def test_required_and_optional_progress_reported_separately(self, authed_client):
        lead = _create_lead(authed_client)
        authed_client.get(f"/api/v1/leads/{lead['id']}/checklist")
        add_res = authed_client.post(f"/api/v1/leads/{lead['id']}/checklist/items", json={"title": "Personal reminder"})
        custom = _item(add_res.json(), "Personal reminder")

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{custom['id']}", json={"status": "complete"})
        progress = res.json()["progress"]
        assert progress["required"] == {"completed": 0, "total": 4, "pct": 0}
        assert progress["optional"] == {"completed": 1, "total": 1, "pct": 100}


class TestNextAction:
    def test_next_action_picks_the_first_actionable_required_task_in_order(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        next_action = checklist["next_action"]
        assert next_action["kind"] == "task"
        assert next_action["item"]["title"] == "Confirm business and contact details"

    def test_next_action_surfaces_blocking_reasons_when_every_required_task_is_blocked(self, authed_client, db_session, workspace):
        search = _make_search(db_session, workspace)
        business = _make_discovered_business(db_session, search)
        checklist = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/checklist").json()

        for title in DEFAULT_DISCOVERY_TITLES:
            item = _item(checklist, title)
            res = authed_client.patch(
                f"/api/v1/stage-checklist-items/{item['id']}",
                json={"status": "blocked", "blocked_reason": f"Blocked: {title}"},
            )
            checklist = res.json()

        next_action = checklist["next_action"]
        assert next_action["kind"] == "blocked"
        assert len(next_action["items"]) == len(DEFAULT_DISCOVERY_TITLES)

    def test_next_action_falls_back_to_optional_when_no_required_actionable_remain(self, authed_client, db_session, workspace):
        search = _make_search(db_session, workspace)
        business = _make_discovered_business(db_session, search)
        checklist = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/checklist").json()

        for title in DEFAULT_DISCOVERY_TITLES:
            item = _item(checklist, title)
            checklist = _complete(authed_client, item["id"])

        add_res = authed_client.post(
            f"/api/v1/discovered-businesses/{business.id}/checklist/items", json={"title": "Nice to have"}
        )
        next_action = add_res.json()["next_action"]
        assert next_action["kind"] == "task"
        assert next_action["item"]["title"] == "Nice to have"

    def test_next_action_is_done_when_nothing_actionable_remains(self, authed_client, db_session, workspace):
        search = _make_search(db_session, workspace)
        business = _make_discovered_business(db_session, search)
        checklist = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/checklist").json()

        for title in DEFAULT_DISCOVERY_TITLES:
            item = _item(checklist, title)
            checklist = _complete(authed_client, item["id"])

        assert checklist["next_action"]["kind"] == "done"


class TestCompletionNotes:
    def test_completing_with_a_note_records_it_without_requiring_one(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "complete"})
        assert res.status_code == 200

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "stage_checklist_item", "entity_id": item["id"]}
        ).json()
        assert any(a["action"] == "completed" for a in activity)

    def test_completing_with_a_note_includes_it_in_history(self, authed_client):
        lead = _create_lead(authed_client)
        checklist = authed_client.get(f"/api/v1/leads/{lead['id']}/checklist").json()
        item = _item(checklist, "Confirm business and contact details")

        res = authed_client.patch(
            f"/api/v1/stage-checklist-items/{item['id']}",
            json={"status": "complete", "note": "Confirmed by phone with the owner."},
        )
        assert res.status_code == 200

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "stage_checklist_item", "entity_id": item["id"]}
        ).json()
        assert any("Confirmed by phone with the owner." in (a["summary"] or "") for a in activity)

    def test_completing_a_manual_review_item_records_which_version_was_reviewed(self, authed_client, monkeypatch):
        from tests.test_planning import _start_and_analyse

        lead = _create_lead(authed_client, "Coastal Cafe")
        result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
        checklist = authed_client.get(f"/api/v1/planning/{result['id']}/checklist").json()
        item = _item(checklist, "Review website audit or new-website research")

        res = authed_client.patch(f"/api/v1/stage-checklist-items/{item['id']}", json={"status": "complete"})
        assert res.status_code == 200

        activity = authed_client.get(
            "/api/v1/activity", params={"entity_type": "stage_checklist_item", "entity_id": item["id"]}
        ).json()
        completed_entry = next(a for a in activity if a["action"] == "completed")
        assert "reviewed" in completed_entry["summary"].lower()
