"""
Every business-domain table reaches its workspace via businesses.
workspace_id (see docs/02_ARCHITECTURE.md §3) — these tests exercise
that no record created in one workspace is visible, listable, or
gettable by a user authenticated into a different workspace.
"""


def test_lead_scoped_to_own_workspace(authed_client, other_authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"}).json()

    other_list = other_authed_client.get("/api/v1/leads").json()
    assert lead["id"] not in [item["id"] for item in other_list]

    other_get = other_authed_client.get(f"/api/v1/leads/{lead['id']}")
    assert other_get.status_code == 404

    other_patch = other_authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"score": 99})
    assert other_patch.status_code == 404

    other_archive = other_authed_client.post(f"/api/v1/leads/{lead['id']}/archive")
    assert other_archive.status_code == 404


def test_business_update_scoped_to_own_workspace(authed_client, other_authed_client):
    business = authed_client.post("/api/v1/businesses", json={"name": "Workspace One Business"}).json()

    other_patch = other_authed_client.patch(
        f"/api/v1/businesses/{business['id']}", json={"email": "hijack@example.com"}
    )
    assert other_patch.status_code == 404


def test_client_scoped_to_own_workspace(authed_client, other_authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Workspace One Client"}).json()

    other_list = other_authed_client.get("/api/v1/clients").json()
    assert client_row["id"] not in [item["id"] for item in other_list]

    other_get = other_authed_client.get(f"/api/v1/clients/{client_row['id']}")
    assert other_get.status_code == 404


def test_project_scoped_to_own_workspace(authed_client, other_authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Workspace One Client"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Site"}
    ).json()

    other_list = other_authed_client.get("/api/v1/projects").json()
    assert project["id"] not in [item["id"] for item in other_list]

    other_get = other_authed_client.get(f"/api/v1/projects/{project['id']}")
    assert other_get.status_code == 404


def test_cannot_create_project_on_another_workspaces_client(authed_client, other_authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Workspace One Client"}).json()

    res = other_authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Hijacked project"}
    )
    assert res.status_code == 404


def test_task_scoped_to_own_workspace(authed_client, other_authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"}).json()
    task = authed_client.post(
        "/api/v1/tasks", json={"title": "Follow up", "lead_id": lead["id"]}
    ).json()

    other_list = other_authed_client.get("/api/v1/tasks").json()
    assert task["id"] not in [item["id"] for item in other_list]

    other_get = other_authed_client.get(f"/api/v1/tasks/{task['id']}")
    assert other_get.status_code == 404


def test_cannot_create_task_on_another_workspaces_lead(authed_client, other_authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"}).json()

    res = other_authed_client.post(
        "/api/v1/tasks", json={"title": "Hijacked task", "lead_id": lead["id"]}
    )
    assert res.status_code == 404


def test_meeting_scoped_to_own_workspace(authed_client, other_authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"}).json()
    meeting = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Discovery call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead["id"]},
    ).json()

    other_list = other_authed_client.get("/api/v1/meetings").json()
    assert meeting["id"] not in [item["id"] for item in other_list]

    other_get = other_authed_client.get(f"/api/v1/meetings/{meeting['id']}")
    assert other_get.status_code == 404


def test_cannot_create_meeting_on_another_workspaces_lead(authed_client, other_authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"}).json()

    res = other_authed_client.post(
        "/api/v1/meetings",
        json={"title": "Hijacked call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead["id"]},
    )
    assert res.status_code == 404


def test_dashboard_overview_scoped_to_own_workspace(authed_client, other_authed_client):
    authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"})

    other_overview = other_authed_client.get("/api/v1/dashboard/overview").json()
    assert other_overview["total_leads"] == 0


def test_activity_feed_scoped_to_own_workspace(authed_client, other_authed_client):
    authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"})

    other_activity = other_authed_client.get("/api/v1/activity").json()
    assert other_activity == []


def test_design_brief_scoped_to_own_workspace(authed_client, other_authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Workspace One Client"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Site"}
    ).json()
    authed_client.patch(f"/api/v1/projects/{project['id']}/brief", json={"business_name": "Workspace One Client"})

    other_get = other_authed_client.get(f"/api/v1/projects/{project['id']}/brief")
    assert other_get.status_code == 404

    other_patch = other_authed_client.patch(
        f"/api/v1/projects/{project['id']}/brief", json={"business_name": "Hijacked"}
    )
    assert other_patch.status_code == 404

    other_approve = other_authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")
    assert other_approve.status_code == 404


def test_cannot_start_intake_on_another_workspaces_client(authed_client, other_authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Workspace One Client"}).json()

    res = other_authed_client.post(f"/api/v1/clients/{client_row['id']}/intake", json={})
    assert res.status_code == 404
