"""
Phase 7 part 2, task 2 — the notification system
(modules/notifications). Covers: creation via the one entry point
(`service.notify`), per-user preferences suppressing a type, anti-spam
deduplication ("do not spam users"), and read/unread history.
"""

from datetime import timedelta

from app.modules.notifications import service
from app.modules.notifications.models import NotificationType


def test_notify_creates_and_lists(authed_client, db_session, admin_user):
    notification = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.DEPLOYMENT_FAILURE,
        title="Deployment failed",
        body="Production deploy for Acme Co failed.",
        href="/dashboard/projects/x",
    )
    assert notification is not None

    res = authed_client.get("/api/v1/notifications")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["type"] == "deployment_failure"
    assert body[0]["read_at"] is None


def test_notifications_require_auth(client):
    assert client.get("/api/v1/notifications").status_code == 401


def test_unread_count_and_mark_read(authed_client, db_session, admin_user):
    service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.FOLLOW_UP_DUE,
        title="Follow-up due",
        body="Bakery Co is due for a follow-up.",
    )

    assert authed_client.get("/api/v1/notifications/unread-count").json() == {"unread_count": 1}

    notification_id = authed_client.get("/api/v1/notifications").json()[0]["id"]
    res = authed_client.post(f"/api/v1/notifications/{notification_id}/read")
    assert res.status_code == 200
    assert res.json()["read_at"] is not None

    assert authed_client.get("/api/v1/notifications/unread-count").json() == {"unread_count": 0}


def test_mark_all_read(authed_client, db_session, admin_user):
    for i in range(3):
        service.notify(
            db_session,
            workspace_id=admin_user.workspace_id,
            user_id=admin_user.id,
            type=NotificationType.MEETING_APPROACHING,
            title=f"Meeting {i}",
            body="x",
            dedupe_key=f"meeting-{i}",
        )
    assert authed_client.get("/api/v1/notifications/unread-count").json()["unread_count"] == 3

    res = authed_client.post("/api/v1/notifications/read-all")
    assert res.json() == {"marked_read": 3}
    assert authed_client.get("/api/v1/notifications/unread-count").json()["unread_count"] == 0


def test_disabled_preference_suppresses_notification(authed_client, db_session, admin_user):
    authed_client.put(
        "/api/v1/notifications/preferences",
        json={"preferences": [{"type": "follow_up_due", "enabled": False}]},
    )

    notification = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.FOLLOW_UP_DUE,
        title="Follow-up due",
        body="x",
    )
    assert notification is None
    assert authed_client.get("/api/v1/notifications").json() == []

    # A different, still-enabled type is unaffected.
    other = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.DEPLOYMENT_FAILURE,
        title="Deploy failed",
        body="x",
    )
    assert other is not None


def test_preferences_default_to_enabled_for_untouched_types(authed_client):
    prefs = {p["type"]: p["enabled"] for p in authed_client.get("/api/v1/notifications/preferences").json()}
    assert all(prefs.values())
    assert set(prefs.keys()) == {t.value for t in NotificationType}


def test_dedupe_key_suppresses_repeat_while_unread(db_session, admin_user):
    first = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.FOLLOW_UP_DUE,
        title="Follow-up due",
        body="Still due",
        dedupe_key="follow-up-123",
    )
    assert first is not None

    # Same underlying event notified again (e.g. a re-run of the daily
    # engine) while the first is still unread — must not spam a second
    # one.
    second = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.FOLLOW_UP_DUE,
        title="Follow-up due",
        body="Still due",
        dedupe_key="follow-up-123",
    )
    assert second is None

    from app.modules.notifications.models import Notification

    assert db_session.query(Notification).count() == 1


def test_dedupe_key_allows_repeat_after_cooldown_once_read(db_session, admin_user):
    from datetime import datetime, timezone

    first = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.FOLLOW_UP_DUE,
        title="Follow-up due",
        body="Still due",
        dedupe_key="follow-up-456",
        cooldown=timedelta(seconds=0),
    )
    service.mark_read(db_session, admin_user.id, first.id)
    # Backdate creation so it's outside even a zero-length cooldown's
    # "just happened" window in practice — cooldown=0 already means
    # "any past moment counts as expired", so this just makes the
    # ordering explicit and robust to clock resolution.
    first.created_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    second = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.FOLLOW_UP_DUE,
        title="Follow-up due",
        body="Still due",
        dedupe_key="follow-up-456",
        cooldown=timedelta(seconds=0),
    )
    assert second is not None
    assert second.id != first.id


def test_dedupe_key_none_never_suppresses(db_session, admin_user):
    first = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.APPROVAL_RECEIVED,
        title="Approved",
        body="x",
    )
    second = service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.APPROVAL_RECEIVED,
        title="Approved",
        body="x",
    )
    assert first is not None
    assert second is not None
    assert first.id != second.id


def test_notifications_are_scoped_to_the_requesting_user(authed_client, member_client, db_session, admin_user, member_user):
    service.notify(
        db_session,
        workspace_id=admin_user.workspace_id,
        user_id=admin_user.id,
        type=NotificationType.APPROVAL_RECEIVED,
        title="For admin only",
        body="x",
    )

    assert len(authed_client.get("/api/v1/notifications").json()) == 1
    assert member_client.get("/api/v1/notifications").json() == []
