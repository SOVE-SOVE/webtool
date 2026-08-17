def test_create_meeting_requires_exactly_one_parent(authed_client):
    res = authed_client.post(
        "/api/v1/meetings", json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z"}
    )
    assert res.status_code == 422


def test_create_meeting_for_lead(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Discovery call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["context"] == "Lead: Hilltop Roofing"
    assert body["held_at"] is None


def test_create_meeting_for_project(authed_client):
    client_res = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"})
    client_id = client_res.json()["id"]
    project_res = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "New website"}
    )
    project_id = project_res.json()["id"]

    res = authed_client.post(
        "/api/v1/meetings",
        json={
            "title": "Kickoff check-in",
            "scheduled_at": "2026-09-01T10:00:00Z",
            "project_id": project_id,
        },
    )
    assert res.status_code == 201
    assert res.json()["context"] == "Project: New website"


def test_create_meeting_unknown_lead_404s(authed_client):
    res = authed_client.post(
        "/api/v1/meetings",
        json={
            "title": "Call",
            "scheduled_at": "2026-09-01T10:00:00Z",
            "lead_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert res.status_code == 404


def test_update_meeting_marks_held_and_sets_outcome(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    meeting = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    ).json()

    res = authed_client.patch(
        f"/api/v1/meetings/{meeting['id']}",
        json={"held_at": "2026-09-01T10:30:00Z", "outcome": "Proceeding to proposal"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["held_at"] is not None
    assert body["outcome"] == "Proceeding to proposal"


def test_delete_meeting(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    meeting = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    ).json()

    res = authed_client.delete(f"/api/v1/meetings/{meeting['id']}")
    assert res.status_code == 204
    assert authed_client.get(f"/api/v1/meetings/{meeting['id']}").status_code == 404


def test_get_meeting_not_found(authed_client):
    res = authed_client.get("/api/v1/meetings/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
