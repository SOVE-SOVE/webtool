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


def test_dashboard_overview_scoped_to_own_workspace(authed_client, other_authed_client):
    authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"})

    other_overview = other_authed_client.get("/api/v1/dashboard/overview").json()
    assert other_overview["total_leads"] == 0


def test_activity_feed_scoped_to_own_workspace(authed_client, other_authed_client):
    authed_client.post("/api/v1/leads", json={"business_name": "Workspace One Lead"})

    other_activity = other_authed_client.get("/api/v1/activity").json()
    assert other_activity == []
