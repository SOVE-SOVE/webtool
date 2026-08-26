"""
Phase 7 part 2, task 2 — notification creation, delivery preferences,
and read/unread history. `notify()` is the one entry point every other
module calls (action_engine, deployments, leads/outreach, approvals,
jobs/runner) to raise a notification; it is the single place that
enforces preferences and anti-spam, so no caller can accidentally bypass
either by creating a `Notification` row directly.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.notifications.models import Notification, NotificationPreference, NotificationType

# How long a suppressed-by-dedupe notification stays suppressed after
# being read — long enough that a job/engine re-running hourly (or even
# a few times a day) doesn't re-raise the same event over and over, per
# the "do not spam users" requirement, short enough that a genuinely
# recurring problem (still-overdue follow-up, still-failing deployment)
# surfaces again rather than going silent forever.
DEFAULT_COOLDOWN = timedelta(hours=12)


def _is_enabled(db: Session, user_id: uuid.UUID, notification_type: NotificationType) -> bool:
    pref = db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id, NotificationPreference.type == notification_type
        )
    )
    # No row yet means the user never touched this preference — default
    # to enabled rather than requiring every type to be explicitly
    # opted into.
    return pref is None or pref.enabled


def get_preferences(db: Session, user_id: uuid.UUID) -> list[dict]:
    rows = {
        p.type: p.enabled
        for p in db.scalars(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    }
    return [{"type": t, "enabled": rows.get(t, True)} for t in NotificationType]


def update_preferences(db: Session, user_id: uuid.UUID, updates: list[tuple[NotificationType, bool]]) -> list[dict]:
    existing = {
        p.type: p
        for p in db.scalars(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    }
    for notification_type, enabled in updates:
        pref = existing.get(notification_type)
        if pref is None:
            db.add(NotificationPreference(user_id=user_id, type=notification_type, enabled=enabled))
        else:
            pref.enabled = enabled
    db.commit()
    return get_preferences(db, user_id)


def _recent_duplicate(
    db: Session,
    *,
    user_id: uuid.UUID,
    notification_type: NotificationType,
    dedupe_key: str,
    cooldown: timedelta,
) -> Notification | None:
    cutoff = datetime.now(timezone.utc) - cooldown
    return db.scalar(
        select(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.type == notification_type,
            Notification.dedupe_key == dedupe_key,
        )
        # Still unread: no need for a second reminder about the exact
        # same thing. Read but recent: still within the cooldown, so
        # skip too — the difference only matters once the cooldown has
        # actually elapsed.
        .where((Notification.read_at.is_(None)) | (Notification.created_at >= cutoff))
        .order_by(Notification.created_at.desc())
        .limit(1)
    )


def notify(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    type: NotificationType,
    title: str,
    body: str,
    href: str | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    dedupe_key: str | None = None,
    cooldown: timedelta = DEFAULT_COOLDOWN,
) -> Notification | None:
    """
    Creates a Notification, unless preferences or anti-spam say not to.
    Returns None (never raises) when suppressed — callers fire-and-forget
    this the way activity_log.record is used elsewhere, since a
    suppressed notification isn't an error condition.

    `dedupe_key` should identify "the same underlying thing" — e.g. a
    follow_up id, a deployment id — so a recurring engine run (the daily
    action engine, a job retry) doesn't raise a fresh notification every
    time it re-notices something that's still true. Pass None only for
    genuinely one-off events that can't recur for the same entity.
    """
    if not _is_enabled(db, user_id, type):
        return None

    if dedupe_key is not None:
        duplicate = _recent_duplicate(
            db, user_id=user_id, notification_type=type, dedupe_key=dedupe_key, cooldown=cooldown
        )
        if duplicate is not None:
            return None

    notification = Notification(
        workspace_id=workspace_id,
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        href=href,
        entity_type=entity_type,
        entity_id=entity_id,
        dedupe_key=dedupe_key,
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return notification


def list_notifications(
    db: Session, user_id: uuid.UUID, unread_only: bool = False, limit: int = 50
) -> list[Notification]:
    query = select(Notification).where(Notification.user_id == user_id)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    return list(db.scalars(query.order_by(Notification.created_at.desc()).limit(limit)))


def unread_count(db: Session, user_id: uuid.UUID) -> int:
    from sqlalchemy import func

    return (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
        or 0
    )


def mark_read(db: Session, user_id: uuid.UUID, notification_id: uuid.UUID) -> Notification | None:
    notification = db.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == user_id)
    )
    if notification is None:
        return None
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notification)
    return notification


def mark_all_read(db: Session, user_id: uuid.UUID) -> int:
    unread = list(
        db.scalars(select(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None)))
    )
    now = datetime.now(timezone.utc)
    for notification in unread:
        notification.read_at = now
    db.commit()
    return len(unread)
