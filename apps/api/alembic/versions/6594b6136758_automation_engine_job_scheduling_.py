"""automation engine: job scheduling, cancellation, logging

Revision ID: 6594b6136758
Revises: 6742373b79d7
Create Date: 2026-08-26

Phase 7 ("Automation Engine") — extends the M7 job queue
(docs/04_ROADMAP.md) with the pieces a generic background-work engine
needs beyond "a table with retries": a CANCELLED terminal status plus a
cooperative-cancellation flag, a structured per-job log trail, and
`job_schedules` — the recurring definitions a poller tick materializes
into new jobs (see app/jobs/runner.py, app/modules/jobs/service.py).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "6594b6136758"
down_revision = "6742373b79d7"
branch_labels = None
depends_on = None

schedule_frequency = sa.Enum("HOURLY", "DAILY", "WEEKLY", name="schedule_frequency")


def upgrade() -> None:
    op.execute("ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'CANCELLED'")

    op.add_column("jobs", sa.Column("logs", postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default="[]"))
    op.add_column(
        "jobs", sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.text("false"))
    )

    op.create_table(
        "job_schedules",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("job_type", sa.String(length=50), nullable=False),
        sa.Column("payload", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("frequency", schedule_frequency, nullable=False),
        sa.Column("run_at_hour", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("day_of_week", sa.Integer(), nullable=True),
        sa.Column("interval_minutes", sa.Integer(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("next_run_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_job_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["last_job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_schedules_job_type", "job_schedules", ["job_type"])


def downgrade() -> None:
    op.drop_index("ix_job_schedules_job_type", table_name="job_schedules")
    op.drop_table("job_schedules")

    bind = op.get_bind()
    schedule_frequency.drop(bind)

    op.drop_column("jobs", "cancel_requested")
    op.drop_column("jobs", "logs")

    # Removing an enum value requires rebuilding the type, same accepted
    # hazard noted in d956f7f5fa17's downgrade — fails if any row is
    # currently CANCELLED, which is an expected, not silently-worked-
    # around, downgrade hazard.
    op.execute("ALTER TABLE jobs ALTER COLUMN status DROP DEFAULT")
    op.execute("ALTER TYPE job_status RENAME TO job_status_old")
    op.execute("CREATE TYPE job_status AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED')")
    op.execute(
        "ALTER TABLE jobs ALTER COLUMN status TYPE job_status USING status::text::job_status"
    )
    op.execute("ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'PENDING'")
    op.execute("DROP TYPE job_status_old")
