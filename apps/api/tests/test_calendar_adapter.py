"""
Tests for the calendar-provider adapter architecture (attendees,
reminders, mock provider, meeting-history filtering) — see
docs/05_DECISIONS.md's entry superseding the earlier
"one provider, one adapter" call for calendar specifically.
"""

from datetime import datetime, timedelta, timezone

import pytest


class TestCalendarProviderRegistry:
    def test_default_provider_is_google(self):
        from app.integrations.calendar.google_provider import GoogleCalendarProvider
        from app.integrations.calendar.registry import get_provider

        assert isinstance(get_provider("google"), GoogleCalendarProvider)

    def test_mock_provider_available_by_name(self):
        from app.integrations.calendar.mock_provider import MockCalendarProvider
        from app.integrations.calendar.registry import get_provider

        assert isinstance(get_provider("mock"), MockCalendarProvider)

    def test_unknown_provider_name_raises_instead_of_silently_falling_back(self):
        from app.integrations.calendar.registry import UnknownCalendarProviderError, get_provider

        with pytest.raises(UnknownCalendarProviderError):
            get_provider("outlook")

    def test_settings_calendar_provider_selects_default(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.calendar.mock_provider import MockCalendarProvider
        from app.integrations.calendar.registry import get_provider

        monkeypatch.setattr(settings, "calendar_provider", "mock")
        assert isinstance(get_provider(), MockCalendarProvider)


class TestMockCalendarProvider:
    def test_always_connected_and_never_hits_the_network(self):
        from app.integrations.calendar.base import CalendarEventInput
        from app.integrations.calendar.mock_provider import MockCalendarProvider
        import uuid

        provider = MockCalendarProvider()
        user_id = uuid.uuid4()
        assert provider.is_connected(db=None, user_id=user_id) is True

        event = CalendarEventInput(
            title="Discovery call",
            description="Lead: Test Co",
            start=datetime.now(timezone.utc),
            duration_minutes=30,
        )
        event_id = provider.create_event(db=None, user_id=user_id, event=event)
        assert event_id is not None and event_id.startswith("mock-event-")
        assert provider.update_event(db=None, user_id=user_id, event_id=event_id, event=event) is True
        assert provider.delete_event(db=None, user_id=user_id, event_id=event_id) is True


def test_meeting_synced_via_mock_provider_without_any_calendar_connection(authed_client, admin_user, monkeypatch):
    """
    The whole point of the mock provider: booking, syncing, and
    rescheduling a meeting works end to end with no CalendarConnection
    row and no real Google account at all.
    """
    from app.core.settings import settings

    monkeypatch.setattr(settings, "calendar_provider", "mock")

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
    body = res.json()
    assert body["synced_to_calendar"] is True

    # Reschedule — still syncs via the mock provider.
    patch_res = authed_client.patch(
        f"/api/v1/meetings/{body['id']}", json={"scheduled_at": "2026-09-02T10:00:00Z"}
    )
    assert patch_res.json()["synced_to_calendar"] is True


def test_domain_logic_never_imports_a_concrete_calendar_provider():
    """
    modules/meetings/service.py must code only against the registry —
    the "do not hard-code a provider into the domain logic" requirement,
    checked structurally rather than just by convention.
    """
    import app.modules.meetings.service as meetings_service

    assert not hasattr(meetings_service, "google_calendar")
    assert hasattr(meetings_service, "calendar_registry")


class TestMeetingAttendees:
    def test_add_and_remove_attendee(self, authed_client):
        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
        meeting = authed_client.post(
            "/api/v1/meetings",
            json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
        ).json()

        add_res = authed_client.post(
            f"/api/v1/meetings/{meeting['id']}/attendees",
            json={"email": "client@example.com", "name": "Pat Client", "is_organizer": False},
        )
        assert add_res.status_code == 201
        attendees = add_res.json()["attendees"]
        assert len(attendees) == 1
        assert attendees[0]["email"] == "client@example.com"
        attendee_id = attendees[0]["id"]

        remove_res = authed_client.delete(f"/api/v1/meetings/{meeting['id']}/attendees/{attendee_id}")
        assert remove_res.status_code == 200
        assert remove_res.json()["attendees"] == []

    def test_remove_unknown_attendee_404s(self, authed_client):
        import uuid

        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
        meeting = authed_client.post(
            "/api/v1/meetings",
            json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
        ).json()

        res = authed_client.delete(f"/api/v1/meetings/{meeting['id']}/attendees/{uuid.uuid4()}")
        assert res.status_code == 404

    def test_create_meeting_with_initial_attendees(self, authed_client):
        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
        res = authed_client.post(
            "/api/v1/meetings",
            json={
                "title": "Call",
                "scheduled_at": "2026-09-01T10:00:00Z",
                "lead_id": lead_id,
                "attendees": [{"email": "a@example.com", "is_organizer": True}, {"email": "b@example.com"}],
            },
        )
        assert res.status_code == 201
        assert {a["email"] for a in res.json()["attendees"]} == {"a@example.com", "b@example.com"}

    def test_attendee_email_never_reaches_google_calendar_event_body(self, authed_client, admin_user, db_session, monkeypatch):
        """
        Attendee info is informational only — the app's "no unnecessary
        emails" rule means a provider must never actually invite anyone.
        """
        from app.core.crypto import encrypt_secret
        from app.modules.calendar.models import CalendarConnection

        db_session.add(
            CalendarConnection(user_id=admin_user.id, encrypted_refresh_token=encrypt_secret("fake-refresh-token"))
        )
        db_session.commit()

        captured_bodies = []

        def fake_refresh(refresh_token):
            return "fake-access-token"

        def fake_create_event(access_token, calendar_id, event):
            captured_bodies.append(event)
            return "google-event-1"

        monkeypatch.setattr("app.integrations.google_calendar.refresh_access_token", fake_refresh)
        monkeypatch.setattr("app.integrations.google_calendar.create_event", fake_create_event)

        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
        authed_client.post(
            "/api/v1/meetings",
            json={
                "title": "Call",
                "scheduled_at": "2026-09-01T10:00:00Z",
                "lead_id": lead_id,
                "assigned_user_id": str(admin_user.id),
                "attendees": [{"email": "should-not-be-invited@example.com"}],
            },
        )
        assert len(captured_bodies) == 1
        # google_calendar.MeetingEvent has no attendees field at all —
        # the adapter drops CalendarEventInput.attendee_emails before
        # this call, so there's nothing here to assert isn't set.
        assert not hasattr(captured_bodies[0], "attendees")


class TestMeetingReminders:
    def test_add_and_remove_reminder(self, authed_client):
        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
        meeting = authed_client.post(
            "/api/v1/meetings",
            json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
        ).json()

        add_res = authed_client.post(
            f"/api/v1/meetings/{meeting['id']}/reminders",
            json={"remind_at": "2026-09-01T09:00:00Z", "note": "Call the client first"},
        )
        assert add_res.status_code == 201
        reminders = add_res.json()["reminders"]
        assert len(reminders) == 1
        assert reminders[0]["channel"] == "in_app"
        reminder_id = reminders[0]["id"]

        remove_res = authed_client.delete(f"/api/v1/meetings/{meeting['id']}/reminders/{reminder_id}")
        assert remove_res.status_code == 200
        assert remove_res.json()["reminders"] == []

    def test_due_reminder_appears_in_due_list_until_acknowledged(self, authed_client):
        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
        meeting = authed_client.post(
            "/api/v1/meetings",
            json={"title": "Call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
        ).json()

        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

        due_reminder = authed_client.post(
            f"/api/v1/meetings/{meeting['id']}/reminders", json={"remind_at": past}
        ).json()["reminders"][0]
        authed_client.post(f"/api/v1/meetings/{meeting['id']}/reminders", json={"remind_at": future})

        due = authed_client.get("/api/v1/meetings/reminders/due").json()
        assert [d["id"] for d in due] == [due_reminder["id"]]
        assert due[0]["meeting_id"] == meeting["id"]
        assert due[0]["meeting_title"] == "Call"

        ack_res = authed_client.post(
            f"/api/v1/meetings/{meeting['id']}/reminders/{due_reminder['id']}/acknowledge"
        )
        assert ack_res.status_code == 200

        due_after_ack = authed_client.get("/api/v1/meetings/reminders/due").json()
        assert due_after_ack == []


class TestMeetingHistoryFiltering:
    def test_list_meetings_filtered_by_lead_id(self, authed_client):
        lead_a = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()["id"]
        lead_b = authed_client.post("/api/v1/leads", json={"business_name": "B"}).json()["id"]
        authed_client.post(
            "/api/v1/meetings", json={"title": "A call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_a}
        )
        authed_client.post(
            "/api/v1/meetings", json={"title": "B call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_b}
        )

        res = authed_client.get(f"/api/v1/meetings?lead_id={lead_a}")
        titles = [m["title"] for m in res.json()]
        assert titles == ["A call"]

    def test_list_meetings_filtered_by_project_id(self, authed_client):
        client_res = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"})
        client_id = client_res.json()["id"]
        project_id = authed_client.post(
            "/api/v1/projects", json={"client_id": client_id, "name": "New website"}
        ).json()["id"]
        authed_client.post(
            "/api/v1/meetings",
            json={"title": "Kickoff", "scheduled_at": "2026-09-01T10:00:00Z", "project_id": project_id},
        )

        lead_id = authed_client.post("/api/v1/leads", json={"business_name": "Other"}).json()["id"]
        authed_client.post(
            "/api/v1/meetings", json={"title": "Unrelated", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id}
        )

        res = authed_client.get(f"/api/v1/meetings?project_id={project_id}")
        titles = [m["title"] for m in res.json()]
        assert titles == ["Kickoff"]
