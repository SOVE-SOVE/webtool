def test_activity_requires_auth(client):
    res = client.get("/api/v1/activity")
    assert res.status_code == 401


def test_creating_a_lead_logs_activity(authed_client, admin_user):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()

    activity = authed_client.get("/api/v1/activity").json()
    assert len(activity) == 1
    entry = activity[0]
    assert entry["entity_type"] == "lead"
    assert entry["entity_id"] == lead["id"]
    assert entry["action"] == "created"
    assert entry["user_id"] == str(admin_user.id)
    assert entry["user_name"] == admin_user.name


def test_lead_status_change_logs_activity(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "researched"})

    activity = authed_client.get("/api/v1/activity").json()
    actions = [a["action"] for a in activity]
    assert "status_changed" in actions


def test_lead_archive_and_unarchive_log_activity(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()
    authed_client.post(f"/api/v1/leads/{lead['id']}/archive")
    authed_client.post(f"/api/v1/leads/{lead['id']}/unarchive")

    activity = authed_client.get("/api/v1/activity").json()
    actions = [a["action"] for a in activity]
    assert "archived" in actions
    assert "unarchived" in actions


def test_activity_filter_by_entity(authed_client):
    lead_a = authed_client.post("/api/v1/leads", json={"business_name": "First"}).json()
    authed_client.post("/api/v1/leads", json={"business_name": "Second"})

    activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "lead", "entity_id": lead_a["id"]}
    ).json()
    assert len(activity) == 1
    assert activity[0]["entity_id"] == lead_a["id"]


def test_assignment_change_logs_activity(authed_client, member_user):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"assigned_user_id": str(member_user.id)})

    activity = authed_client.get("/api/v1/activity").json()
    assigned_entries = [a for a in activity if a["action"] == "assigned"]
    assert len(assigned_entries) == 1
    assert assigned_entries[0]["summary"] == "Reassigned"


def test_task_completion_logs_activity(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()
    task = authed_client.post(
        "/api/v1/tasks", json={"title": "Call back", "lead_id": lead["id"]}
    ).json()
    authed_client.patch(f"/api/v1/tasks/{task['id']}", json={"done": True})

    activity = authed_client.get("/api/v1/activity").json()
    actions = [a["action"] for a in activity if a["entity_type"] == "task"]
    assert "created" in actions
    assert "completed" in actions


def test_project_and_client_actions_log_activity(authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "New site"}
    ).json()
    authed_client.patch(f"/api/v1/projects/{project['id']}", json={"stage": "brief"})

    activity = authed_client.get("/api/v1/activity").json()
    client_actions = [a["action"] for a in activity if a["entity_type"] == "client"]
    project_actions = [a["action"] for a in activity if a["entity_type"] == "project"]
    assert "created" in client_actions
    assert "created" in project_actions
    assert "stage_changed" in project_actions


def test_activity_feed_is_newest_first(authed_client):
    authed_client.post("/api/v1/leads", json={"business_name": "First"})
    authed_client.post("/api/v1/leads", json={"business_name": "Second"})

    activity = authed_client.get("/api/v1/activity").json()
    summaries = [a["summary"] for a in activity if a["action"] == "created"]
    assert summaries[0] == "Created lead for Second"
    assert summaries[1] == "Created lead for First"
