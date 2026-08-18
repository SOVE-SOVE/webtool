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


def test_create_meeting_defaults_type_status_duration(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    )
    body = res.json()
    assert body["meeting_type"] == "sales_call"
    assert body["status"] == "scheduled"
    assert body["duration_minutes"] == 30
    assert body["synced_to_calendar"] is False
    assert body["brief"] is None


def test_create_meeting_for_project_defaults_client_check_in(authed_client):
    client_id = authed_client.post("/api/v1/clients", json={"business_name": "A"}).json()["id"]
    project_id = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Site"}
    ).json()["id"]

    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Check-in", "scheduled_at": "2026-09-01T10:00:00Z", "project_id": project_id},
    )
    assert res.json()["meeting_type"] == "client_check_in"


def test_create_meeting_explicit_type_overrides_default(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    res = authed_client.post(
        "/api/v1/meetings",
        json={
            "title": "Call",
            "meeting_type": "other",
            "scheduled_at": "2026-09-01T10:00:00Z",
            "lead_id": lead_id,
        },
    )
    assert res.json()["meeting_type"] == "other"


def test_create_meeting_assigned_user_defaults_from_lead(authed_client, member_user):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"assigned_user_id": str(member_user.id)})

    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead["id"]},
    )
    assert res.json()["assigned_user_id"] == str(member_user.id)


def test_create_meeting_assigned_user_explicit_overrides_lead_default(authed_client, admin_user, member_user):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"assigned_user_id": str(member_user.id)})

    res = authed_client.post(
        "/api/v1/meetings",
        json={
            "title": "Call",
            "scheduled_at": "2026-09-01T10:00:00Z",
            "lead_id": lead["id"],
            "assigned_user_id": str(admin_user.id),
        },
    )
    assert res.json()["assigned_user_id"] == str(admin_user.id)


def test_booking_meeting_bumps_lead_status_to_meeting(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    assert lead["status"] == "new"

    authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead["id"]},
    )

    updated_lead = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert updated_lead["status"] == "meeting"


def test_booking_meeting_does_not_regress_further_along_lead(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "proposal"})

    authed_client.post(
        "/api/v1/meetings",
        json={"title": "Follow-up call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead["id"]},
    )

    updated_lead = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert updated_lead["status"] == "proposal"


def test_booking_project_meeting_does_not_touch_any_lead(authed_client):
    client_id = authed_client.post("/api/v1/clients", json={"business_name": "A"}).json()["id"]
    project_id = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Site"}
    ).json()["id"]

    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Check-in", "scheduled_at": "2026-09-01T10:00:00Z", "project_id": project_id},
    )
    assert res.status_code == 201  # just proving no lead-lookup crash on a project meeting


def test_update_meeting_status_transitions(authed_client):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    meeting = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    ).json()

    res = authed_client.patch(f"/api/v1/meetings/{meeting['id']}", json={"status": "held"})
    body = res.json()
    assert body["status"] == "held"
    assert body["held_at"] is not None  # auto-set on the scheduled -> held transition


def test_update_meeting_reassign(authed_client, member_user):
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    meeting = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    ).json()

    res = authed_client.patch(
        f"/api/v1/meetings/{meeting['id']}", json={"assigned_user_id": str(member_user.id)}
    )
    assert res.json()["assigned_user_id"] == str(member_user.id)

    res = authed_client.patch(f"/api/v1/meetings/{meeting['id']}", json={"assigned_user_id": None})
    assert res.json()["assigned_user_id"] is None


def test_meeting_brief_not_generated_without_llm_key_configured(authed_client):
    """conftest.py sets LLM_API_KEY="" — brief generation must be skipped, not attempted/fail."""
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    )
    assert res.json()["brief"] is None


def test_meeting_brief_generated_for_lead_meeting(authed_client, monkeypatch):
    from app.core.settings import settings

    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    fake_output = {
        "summary": "First touch with this lead.",
        "talking_points": ["Ask about their current site", "Mention the core package"],
        "open_items": ["Confirm timeline"],
    }
    monkeypatch.setattr("app.agents.meeting_brief.generate_structured", lambda **kwargs: dict(fake_output))

    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    )
    brief = res.json()["brief"]
    assert brief is not None
    assert brief["summary"] == "First touch with this lead."
    assert brief["talking_points"] == ["Ask about their current site", "Mention the core package"]
    assert brief["flagged_for_review"] is True  # no sales audit/outreach/meeting history yet


def test_meeting_brief_not_generated_for_project_meeting(authed_client, monkeypatch):
    from app.core.settings import settings

    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(
        "app.agents.meeting_brief.generate_structured",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("should not be called for a project meeting")),
    )

    client_id = authed_client.post("/api/v1/clients", json={"business_name": "A"}).json()["id"]
    project_id = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Site"}
    ).json()["id"]

    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Check-in", "scheduled_at": "2026-09-01T10:00:00Z", "project_id": project_id},
    )
    assert res.json()["brief"] is None


def test_meeting_brief_generation_failure_does_not_block_booking(authed_client, monkeypatch):
    from app.core.settings import settings

    monkeypatch.setattr(settings, "llm_api_key", "test-key")

    def _boom(**kwargs):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr("app.agents.meeting_brief.generate_structured", _boom)

    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    res = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    )
    assert res.status_code == 201
    assert res.json()["brief"] is None


def test_meeting_synced_when_assigned_user_has_calendar_connected(authed_client, admin_user, db_session, monkeypatch):
    from app.core.crypto import encrypt_secret
    from app.modules.calendar.models import CalendarConnection

    db_session.add(
        CalendarConnection(
            user_id=admin_user.id,
            google_email="admin@example.com",
            encrypted_refresh_token=encrypt_secret("fake-refresh-token"),
        )
    )
    db_session.commit()

    def fake_refresh(refresh_token):
        assert refresh_token == "fake-refresh-token"
        return "fake-access-token"

    def fake_create_event(access_token, calendar_id, event):
        assert access_token == "fake-access-token"
        assert calendar_id == "primary"
        return "google-event-123"

    monkeypatch.setattr("app.modules.meetings.service.google_calendar.refresh_access_token", fake_refresh)
    monkeypatch.setattr("app.modules.meetings.service.google_calendar.create_event", fake_create_event)

    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    res = authed_client.post(
        "/api/v1/meetings",
        json={
            "title": "Call",
            "scheduled_at": "2026-09-01T10:00:00Z",
            "lead_id": lead_id,
            "assigned_user_id": str(admin_user.id),
        },
    )
    assert res.json()["synced_to_calendar"] is True


def test_meeting_creation_survives_calendar_sync_failure(authed_client, admin_user, db_session, monkeypatch):
    from app.core.crypto import encrypt_secret
    from app.integrations import google_calendar
    from app.modules.calendar.models import CalendarConnection

    db_session.add(
        CalendarConnection(
            user_id=admin_user.id, encrypted_refresh_token=encrypt_secret("fake-refresh-token")
        )
    )
    db_session.commit()

    def failing_refresh(refresh_token):
        raise google_calendar.GoogleCalendarError("token expired")

    monkeypatch.setattr("app.modules.meetings.service.google_calendar.refresh_access_token", failing_refresh)

    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
    res = authed_client.post(
        "/api/v1/meetings",
        json={
            "title": "Call",
            "scheduled_at": "2026-09-01T10:00:00Z",
            "lead_id": lead_id,
            "assigned_user_id": str(admin_user.id),
        },
    )
    assert res.status_code == 201
    assert res.json()["synced_to_calendar"] is False
