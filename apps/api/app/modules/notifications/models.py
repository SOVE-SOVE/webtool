"""
Phase 7 part 2, task 2 — a notification is the push/inbox counterpart
to the action_engine's pull-based queue: the queue is "here's everything
that needs doing, ranked" the operator has to go look at, a
notification is "something happened, here's a heads up" that shows up
as an unread badge. The two are wired together (action_engine.service
calls `notify` for newly-surfaced high-priority items) but are separate
concerns — not every notification corresponds to a queue item (e.g.
"approval received" or "automation failure" aren't ranked actions) and
not every queue item is worth interrupting the operator for every day
it's still open (see `notify`'s cooldown/dedupe below).
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class NotificationType(str, enum.Enum):
    """The eight kinds from the phase-7 spec, verbatim."""

    NEW_HIGH_VALUE_LEAD = "new_high_value_lead"
    FOLLOW_UP_DUE = "follow_up_due"
    MEETING_APPROACHING = "meeting_approaching"
    CLIENT_FEEDBACK = "client_feedback"
    APPROVAL_RECEIVED = "approval_received"
    DEPLOYMENT_FAILURE = "deployment_failure"
    PROJECT_DEADLINE = "project_deadline"
    AUTOMATION_FAILURE = "automation_failure"


class Notification(Base):
    """One entry in a user's notification history. `dedupe_key` plus
    `created_at` is how `service.notify` avoids spamming the same user
    with the same underlying event repeatedly — see its docstring."""

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType, name="notification_type"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    href: Mapped[str | None] = mapped_column(String(255))

    entity_type: Mapped[str | None] = mapped_column(String(50))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # Identifies "the same underlying thing" across repeated notify()
    # calls for the same (user, type) — e.g. a specific follow_up id, or
    # a specific deployment id. Distinct from entity_id only in that
    # entity_id is nullable/informational while dedupe_key is what
    # anti-spam actually keys on; in practice they're usually the same
    # string. Null means "never dedupe this one" (rare — most notify()
    # callers pass one).
    dedupe_key: Mapped[str | None] = mapped_column(String(255), index=True)

    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class NotificationPreference(Base):
    """Per-user, per-type opt-out. Absence of a row for a given type
    means "enabled" (the default) — see service.py's `_is_enabled` — so
    a new NotificationType added later doesn't silently start firing
    for users who never got a chance to configure it, and doesn't
    require a backfill migration either."""

    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "type", name="uq_notification_preference_user_type"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[NotificationType] = mapped_column(Enum(NotificationType, name="notification_type"))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
