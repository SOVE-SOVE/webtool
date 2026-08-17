def test_calendar_requires_date_range(authed_client):
    res = authed_client.get("/api/v1/calendar")
    assert res.status_code == 422


def test_calendar_includes_meeting_in_range(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    authed_client.post(
        "/api/v1/meetings",
        json={"title": "Discovery call", "scheduled_at": "2026-09-15T10:00:00Z", "lead_id": lead_id},
    )

    res = authed_client.get("/api/v1/calendar?start=2026-09-01&end=2026-09-30")
    assert res.status_code == 200
    events = res.json()
    assert len(events) == 1
    assert events[0]["kind"] == "meeting"
    assert events[0]["title"] == "Discovery call"
    assert events[0]["detail"] == "Lead: A"


def test_calendar_excludes_meeting_outside_range(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    authed_client.post(
        "/api/v1/meetings",
        json={"title": "Discovery call", "scheduled_at": "2026-10-15T10:00:00Z", "lead_id": lead_id},
    )

    res = authed_client.get("/api/v1/calendar?start=2026-09-01&end=2026-09-30")
    assert res.json() == []


def test_calendar_includes_open_task_due_date(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    authed_client.post(
        "/api/v1/tasks",
        json={"title": "Follow up", "lead_id": lead_id, "due_at": "2026-09-10T09:00:00Z"},
    )

    res = authed_client.get("/api/v1/calendar?start=2026-09-01&end=2026-09-30")
    events = res.json()
    assert len(events) == 1
    assert events[0]["kind"] == "task"
    assert events[0]["title"] == "Follow up"


def test_calendar_excludes_done_task(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    task = authed_client.post(
        "/api/v1/tasks",
        json={"title": "Follow up", "lead_id": lead_id, "due_at": "2026-09-10T09:00:00Z"},
    ).json()
    authed_client.patch(f"/api/v1/tasks/{task['id']}", json={"done": True})

    res = authed_client.get("/api/v1/calendar?start=2026-09-01&end=2026-09-30")
    assert res.json() == []


def test_calendar_excludes_undated_task(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    authed_client.post("/api/v1/tasks", json={"title": "No due date", "lead_id": lead_id})

    res = authed_client.get("/api/v1/calendar?start=2026-09-01&end=2026-09-30")
    assert res.json() == []


def test_calendar_scoped_to_own_workspace(authed_client, other_authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    authed_client.post(
        "/api/v1/meetings",
        json={"title": "Discovery call", "scheduled_at": "2026-09-15T10:00:00Z", "lead_id": lead_id},
    )

    res = other_authed_client.get("/api/v1/calendar?start=2026-09-01&end=2026-09-30")
    assert res.json() == []
