def _create_client(authed_client, name: str = "Coastal Cafe") -> str:
    res = authed_client.post("/api/v1/clients", json={"business_name": name})
    return res.json()["id"]


def _create_lead(authed_client, name: str = "Hilltop Roofing") -> str:
    res = authed_client.post("/api/v1/leads", json={"business_name": name})
    return res.json()["id"]


def test_create_and_list_projects(authed_client):
    client_id = _create_client(authed_client)

    res = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "New website"
    assert body["stage"] == "intake"
    assert body["client_business_name"] == "Coastal Cafe"

    list_res = authed_client.get("/api/v1/projects")
    assert len(list_res.json()) == 1


def test_create_project_unknown_client_404s(authed_client):
    res = authed_client.post(
        "/api/v1/projects",
        json={"client_id": "00000000-0000-0000-0000-000000000000", "name": "New website"},
    )
    assert res.status_code == 404


def test_update_project_stage(authed_client):
    client_id = _create_client(authed_client)
    create_res = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"})
    project_id = create_res.json()["id"]

    patch_res = authed_client.patch(f"/api/v1/projects/{project_id}", json={"stage": "brief"})
    assert patch_res.status_code == 200
    assert patch_res.json()["stage"] == "brief"


def test_project_stage_covers_full_pipeline(authed_client):
    client_id = _create_client(authed_client)
    create_res = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"})
    project_id = create_res.json()["id"]

    full_pipeline = [
        "intake", "research", "brief", "design", "development", "qa",
        "client_review", "revisions", "ready_to_deploy", "deployed",
        "maintenance", "complete",
    ]
    for stage in full_pipeline:
        res = authed_client.patch(f"/api/v1/projects/{project_id}", json={"stage": stage})
        assert res.status_code == 200
        assert res.json()["stage"] == stage


def test_project_agreed_terms_settable_and_editable(authed_client):
    client_id = _create_client(authed_client)
    create_res = authed_client.post(
        "/api/v1/projects",
        json={
            "client_id": client_id,
            "name": "New website",
            "package": "Core",
            "price_cents": 89900,
            "deadline": "2026-10-01",
        },
    )
    body = create_res.json()
    assert body["package"] == "Core"
    assert body["price_cents"] == 89900
    assert body["deadline"] == "2026-10-01"
    assert body["source_lead_id"] is None

    patch_res = authed_client.patch(
        f"/api/v1/projects/{body['id']}", json={"price_cents": 99900, "deadline": None}
    )
    patched = patch_res.json()
    assert patched["price_cents"] == 99900
    assert patched["deadline"] is None
    assert patched["package"] == "Core"


def test_create_project_requires_exactly_one_owner(authed_client):
    res = authed_client.post("/api/v1/projects", json={"name": "New website"})
    assert res.status_code == 422

    client_id = _create_client(authed_client)
    lead_id = _create_lead(authed_client)
    res = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "lead_id": lead_id, "name": "New website"}
    )
    assert res.status_code == 422


def test_create_prospect_project_from_lead_has_no_client(authed_client):
    lead_id = _create_lead(authed_client)

    res = authed_client.post("/api/v1/projects", json={"lead_id": lead_id, "name": "Hilltop Roofing Website"})
    assert res.status_code == 201
    body = res.json()
    assert body["client_id"] is None
    assert body["source_lead_id"] == lead_id
    assert body["stage"] == "intake"

    lead_after = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead_after["status"] == "new"
    assert lead_after["client_id"] is None
    assert lead_after["prospect_project"]["id"] == body["id"]

    assert authed_client.get("/api/v1/clients").json() == []


def test_create_prospect_project_unknown_lead_404s(authed_client):
    res = authed_client.post(
        "/api/v1/projects",
        json={"lead_id": "00000000-0000-0000-0000-000000000000", "name": "New website"},
    )
    assert res.status_code == 404


def test_start_website_project_is_idempotent_on_repeated_clicks(authed_client):
    lead_id = _create_lead(authed_client)

    first = authed_client.post("/api/v1/projects", json={"lead_id": lead_id, "name": "Hilltop Roofing Website"}).json()
    second = authed_client.post("/api/v1/projects", json={"lead_id": lead_id, "name": "Hilltop Roofing Website"}).json()
    assert second["id"] == first["id"]

    all_projects = authed_client.get("/api/v1/projects").json()
    matching = [p for p in all_projects if p["source_lead_id"] == lead_id]
    assert len(matching) == 1


def test_prospect_project_is_reachable_through_every_normal_workspace_scoped_endpoint(authed_client):
    """The core regression risk of the workspace_id migration: a
    Lead-owned Project (no client_id) must be just as reachable through
    every workspace-scoped module as a Client-owned one, since a plain
    Project.client_id == Client.id join would silently exclude it."""
    lead_id = _create_lead(authed_client)
    project_id = authed_client.post(
        "/api/v1/projects", json={"lead_id": lead_id, "name": "Hilltop Roofing Website"}
    ).json()["id"]

    assert authed_client.get(f"/api/v1/projects/{project_id}").status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}/brief").status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}/sitemaps").status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}/creative-directions").status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}/websites").status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}/deployments").status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}/approvals").status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}/previews").status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}/feedback").status_code == 200

    task = authed_client.post("/api/v1/tasks", json={"project_id": project_id, "title": "Do the thing"})
    assert task.status_code == 201
    tasks = authed_client.get("/api/v1/tasks").json()
    assert any(t["project_id"] == project_id for t in tasks)

    approve = authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")
    assert approve.status_code == 200
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "brief"


# --- Checklist summaries (bulk, workspace-wide) ---------------------------------


def test_project_checklist_summaries_reflects_progress_and_next_item(authed_client):
    client_id = _create_client(authed_client)
    project = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"}).json()

    summaries = authed_client.get("/api/v1/projects/checklist-summaries").json()
    assert len(summaries) == 1
    summary = summaries[0]
    assert summary["project_id"] == project["id"]
    assert summary["total"] == 6  # len(DEFAULT_PROJECT_STAGE_TASKS), all required
    assert summary["completed"] == 0
    assert summary["pct"] == 0
    assert summary["next_item_title"] == "Review build inputs"
    assert summary["blocked_reason"] is None

    checklist = authed_client.get(f"/api/v1/projects/{project['id']}/checklist").json()
    first_item_id = checklist["items"][0]["id"]
    authed_client.patch(f"/api/v1/stage-checklist-items/{first_item_id}", json={"status": "complete"})

    summaries = authed_client.get("/api/v1/projects/checklist-summaries").json()
    assert summaries[0]["completed"] == 1


def test_project_checklist_summaries_surfaces_a_blocked_reason(authed_client):
    """next_action only reports "blocked" once every remaining required
    task is actually blocked (see checklists/shared.py::select_next_action)
    — blocking just the first item still leaves later ones actionable,
    so this blocks every required item to reach that state."""
    client_id = _create_client(authed_client)
    project = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"}).json()
    checklist = authed_client.get(f"/api/v1/projects/{project['id']}/checklist").json()

    for item in checklist["items"]:
        authed_client.patch(
            f"/api/v1/stage-checklist-items/{item['id']}",
            json={"status": "blocked", "blocked_reason": "Waiting on the client for photos"},
        )

    summaries = authed_client.get("/api/v1/projects/checklist-summaries").json()
    assert summaries[0]["blocked_reason"] == "Waiting on the client for photos"


def test_project_checklist_summaries_is_workspace_scoped(authed_client, other_authed_client):
    client_id = _create_client(authed_client)
    authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"})

    assert authed_client.get("/api/v1/projects/checklist-summaries").json() != []
    assert other_authed_client.get("/api/v1/projects/checklist-summaries").json() == []
