def test_create_task_requires_exactly_one_parent(authed_client):
    res = authed_client.post("/api/v1/tasks", json={"title": "Follow up"})
    assert res.status_code == 422


def test_create_task_for_lead(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    res = authed_client.post("/api/v1/tasks", json={"title": "Call back", "lead_id": lead_id})
    assert res.status_code == 201
    body = res.json()
    assert body["context"] == "Lead: Hilltop Roofing"
    assert body["done"] is False


def test_create_task_for_project_and_mark_done(authed_client):
    client_res = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"})
    client_id = client_res.json()["id"]
    project_res = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"})
    project_id = project_res.json()["id"]

    task_res = authed_client.post("/api/v1/tasks", json={"title": "Draft sitemap", "project_id": project_id})
    assert task_res.status_code == 201
    task_id = task_res.json()["id"]
    assert task_res.json()["context"] == "Project: New website"

    done_res = authed_client.patch(f"/api/v1/tasks/{task_id}", json={"done": True})
    assert done_res.status_code == 200
    assert done_res.json()["done"] is True


def test_create_task_unknown_lead_404s(authed_client):
    res = authed_client.post(
        "/api/v1/tasks", json={"title": "x", "lead_id": "00000000-0000-0000-0000-000000000000"}
    )
    assert res.status_code == 404
