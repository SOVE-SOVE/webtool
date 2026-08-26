def _create_client(authed_client, name: str = "Coastal Cafe") -> str:
    res = authed_client.post("/api/v1/clients", json={"business_name": name})
    return res.json()["id"]


def _approved_project(authed_client, name: str = "Coastal Cafe") -> str:
    client_id = _create_client(authed_client, name)
    brief = authed_client.post(
        f"/api/v1/clients/{client_id}/intake", json={"business_name": name}
    ).json()
    project_id = brief["project_id"]
    authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")
    return project_id


def test_approving_brief_creates_a_full_plan_covering_every_stage(authed_client):
    from app.modules.projects.models import ProjectStage

    project_id = _approved_project(authed_client)

    res = authed_client.get(f"/api/v1/projects/{project_id}/plan")
    assert res.status_code == 200
    body = res.json()
    assert body["project_id"] == project_id
    assert [s["stage"] for s in body["stages"]] == [s.value for s in ProjectStage]
    # sort_order tracks the pipeline order
    assert [s["sort_order"] for s in body["stages"]] == list(range(len(body["stages"])))


def test_brief_and_earlier_stages_start_done_and_approved_later_stages_pending(authed_client):
    project_id = _approved_project(authed_client)
    stages = {s["stage"]: s for s in authed_client.get(f"/api/v1/projects/{project_id}/plan").json()["stages"]}

    assert stages["intake"]["status"] == "done"
    assert stages["research"]["status"] == "done"
    assert stages["brief"]["status"] == "done"
    assert stages["brief"]["requires_approval"] is True
    assert stages["brief"]["approved"] is True
    assert stages["brief"]["approved_by_user_name"] is not None

    assert stages["design"]["status"] == "pending"
    assert stages["design"]["requires_approval"] is True
    assert stages["design"]["approved"] is False
    assert stages["maintenance"]["requires_approval"] is False


def test_plan_stages_default_due_dates_are_staggered_forward(authed_client):
    project_id = _approved_project(authed_client)
    stages = authed_client.get(f"/api/v1/projects/{project_id}/plan").json()["stages"]

    due_dates = [s["due_at"] for s in stages]
    assert due_dates == sorted(due_dates)
    assert len(set(due_dates)) > 1


def test_plan_seeds_default_tasks_per_stage_without_duplicating_intake_checklist(authed_client):
    from app.modules.projects.service import DEFAULT_INTAKE_TASK_TITLES

    project_id = _approved_project(authed_client)
    tasks = [t for t in authed_client.get("/api/v1/tasks").json() if t["project_id"] == project_id]

    intake_titles = {t["title"] for t in tasks if t["stage"] == "intake"}
    assert intake_titles == set(DEFAULT_INTAKE_TASK_TITLES)

    design_tasks = [t for t in tasks if t["stage"] == "design"]
    assert len(design_tasks) > 0
    assert all(t["done"] is False for t in design_tasks)

    # DEPLOYED's launch checklist isn't seeded by the plan — only on a
    # real deploy (projects/service.py::create_launch_tasks).
    assert not any(t["stage"] == "deployed" for t in tasks)

    plan = authed_client.get(f"/api/v1/projects/{project_id}/plan").json()
    design_stage = next(s for s in plan["stages"] if s["stage"] == "design")
    assert design_stage["task_count"] == len(design_tasks)
    assert design_stage["tasks_done"] == 0


def test_plan_stage_default_responsible_user_is_the_projects_assignee(authed_client):
    client_id = _create_client(authed_client)
    users = authed_client.get("/api/v1/users").json()
    user_id = users[0]["id"]

    project = authed_client.post(
        "/api/v1/projects",
        json={"client_id": client_id, "name": "Coastal Cafe site", "assigned_user_id": user_id},
    ).json()
    authed_client.patch(f"/api/v1/projects/{project['id']}/brief", json={"business_name": "Coastal Cafe"})
    authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")

    stages = authed_client.get(f"/api/v1/projects/{project['id']}/plan").json()["stages"]
    assert all(s["responsible_user_id"] == user_id for s in stages)


def test_plan_stage_is_fully_editable(authed_client):
    project_id = _approved_project(authed_client)
    users = authed_client.get("/api/v1/users").json()
    user_id = users[0]["id"]
    stages = authed_client.get(f"/api/v1/projects/{project_id}/plan").json()["stages"]
    design_stage_id = next(s["id"] for s in stages if s["stage"] == "design")

    res = authed_client.patch(
        f"/api/v1/project-plan-stages/{design_stage_id}",
        json={
            "label": "Design phase",
            "due_at": "2026-12-01",
            "requires_approval": False,
            "responsible_user_id": user_id,
            "status": "in_progress",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["label"] == "Design phase"
    assert body["due_at"] == "2026-12-01"
    assert body["requires_approval"] is False
    assert body["responsible_user_id"] == user_id
    assert body["status"] == "in_progress"


def test_approve_stage_requires_approval_flag(authed_client):
    project_id = _approved_project(authed_client)
    stages = authed_client.get(f"/api/v1/projects/{project_id}/plan").json()["stages"]
    maintenance_stage_id = next(s["id"] for s in stages if s["stage"] == "maintenance")

    res = authed_client.post(f"/api/v1/project-plan-stages/{maintenance_stage_id}/approve")
    assert res.status_code == 400


def test_approve_stage_marks_it_approved_and_done(authed_client):
    project_id = _approved_project(authed_client)
    stages = authed_client.get(f"/api/v1/projects/{project_id}/plan").json()["stages"]
    design_stage_id = next(s["id"] for s in stages if s["stage"] == "design")

    res = authed_client.post(f"/api/v1/project-plan-stages/{design_stage_id}/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["approved"] is True
    assert body["status"] == "done"
    assert body["approved_by_user_name"] is not None
    assert body["approved_at"] is not None


def test_plan_not_created_before_brief_is_approved(authed_client):
    client_id = _create_client(authed_client)
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Coastal Cafe site"}
    ).json()

    res = authed_client.get(f"/api/v1/projects/{project['id']}/plan")
    assert res.status_code == 200
    assert res.json()["stages"] == []


def test_reapproving_an_edited_brief_does_not_duplicate_the_plan(authed_client):
    project_id = _approved_project(authed_client)
    first = authed_client.get(f"/api/v1/projects/{project_id}/plan").json()

    # Editing the approved brief reverts it to draft; re-approving moves
    # the project's stage forward by zero (it's already at/past BRIEF),
    # so the plan must not be rebuilt or duplicated.
    authed_client.patch(f"/api/v1/projects/{project_id}/brief", json={"business_name": "Coastal Cafe & Bakery"})
    authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")

    second = authed_client.get(f"/api/v1/projects/{project_id}/plan").json()
    assert len(second["stages"]) == len(first["stages"])
    assert [s["id"] for s in second["stages"]] == [s["id"] for s in first["stages"]]


def test_plan_unknown_project_404s(authed_client):
    res = authed_client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/plan")
    assert res.status_code == 404


def test_update_unknown_stage_404s(authed_client):
    res = authed_client.patch(
        "/api/v1/project-plan-stages/00000000-0000-0000-0000-000000000000", json={"label": "x"}
    )
    assert res.status_code == 404


def test_plan_is_workspace_scoped(authed_client, other_authed_client):
    project_id = _approved_project(authed_client)

    res = other_authed_client.get(f"/api/v1/projects/{project_id}/plan")
    assert res.status_code == 404
