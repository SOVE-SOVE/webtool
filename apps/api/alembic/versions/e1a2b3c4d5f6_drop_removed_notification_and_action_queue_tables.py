"""drop removed notification + action-queue tables

Revision ID: e1a2b3c4d5f6
Revises: d5e9a3c7f201
Create Date: 2026-09-04 22:30:00.000000

The in-app notification centre and the daily "action queue" feature were
removed — their models (`Notification`, `NotificationPreference`,
`ActionQueueItem`, `DailyActionRun`) are gone. Those tables were only
ever created by `Base.metadata.create_all()` in older dev/test runs, not
by a migration, so a fresh database never had them and this migration is
a no-op there. On a long-lived database they linger as orphans that
`alembic check` flags forever. Drop them (and their enum types) so
models and schema agree again.

`IF EXISTS` throughout keeps this safe to run against a database that
never had the tables. No downgrade — recreating dead, model-less tables
would serve no purpose.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "e1a2b3c4d5f6"
down_revision: Union[str, None] = "d5e9a3c7f201"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("action_queue_items", "daily_action_runs", "notifications", "notification_preferences")
_ENUMS = ("action_kind", "notification_type")


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    for enum in _ENUMS:
        op.execute(f"DROP TYPE IF EXISTS {enum}")


def downgrade() -> None:
    pass
