import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.users.models import User
    from app.modules.workspaces.models import Workspace


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


# A job in one of these statuses is finished — no further transition,
# same terminal-state contract used elsewhere (e.g. DiscoveredBusiness's
# _NOT_IMPORTABLE_STATUSES).
TERMINAL_JOB_STATUSES = (JobStatus.DONE, JobStatus.FAILED, JobStatus.CANCELLED)


class Job(Base):
    """
    Background-work queue, per docs/02_ARCHITECTURE.md §4 ("a job table,
    not Celery/Redis") — first built in M7 as the Lead Intelligence
    architecture piece, extended here (Phase 7) into the generic
    automation engine every scheduled/long-running capability runs on:
    an in-process poller (app/jobs/runner.py) claims PENDING rows via
    `SELECT ... FOR UPDATE SKIP LOCKED`, so it survives a process restart
    and tolerates more than one poller running at once without
    double-processing a job.

    `run_after` defaults to now (run ASAP) but can be set in the future —
    what makes scheduled work possible, materialized by
    `JobSchedule`/`app/jobs/scheduler.py` rather than by hand.

    `cancel_requested` is cooperative: a PENDING job is cancelled
    immediately (it never gets claimed — see `service.request_cancel`),
    but a RUNNING job can only be asked to stop; a handler that does
    meaningful work in a loop (discovery batches, research batches) is
    expected to check `service.is_cancel_requested` between units of work
    and raise `JobCancelled` to stop cleanly. A handler that never checks
    simply runs to completion — cancellation only has a hook where a
    handler actually has one to offer.

    `logs` is a structured, append-only progress trail distinct from
    `error_message`/`result` — the "logging" requirement from the Phase 7
    automation-engine spec: what a job actually did while it ran, not
    just how it ended.
    """

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    job_type: Mapped[str] = mapped_column(String(50), index=True)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus, name="job_status"), default=JobStatus.PENDING)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)
    logs: Mapped[list] = mapped_column(JSON, default=list)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)

    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workspace: Mapped["Workspace"] = relationship()
    created_by_user: Mapped["User | None"] = relationship()


class ScheduleFrequency(str, enum.Enum):
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"


class JobSchedule(Base):
    """
    A recurring definition that materializes into `Job` rows over time —
    the "scheduling" half of the automation engine, kept generic across
    every job type (lead discovery, reports, QA, ...) rather than one
    schedule table per capability. `app/jobs/scheduler.py` is the only
    writer of `next_run_at`/`last_run_at`/`last_job_id`.

    `run_at_hour` (0-23, UTC) plus `day_of_week` (0=Monday, WEEKLY only)
    give exactly the recurrence shapes the spec actually asks for
    ("every morning", "every N hours") without a full cron grammar the
    single-operator system has no other use for — see
    `app/jobs/scheduler.py::compute_next_run_at`.
    """

    __tablename__ = "job_schedules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    name: Mapped[str | None] = mapped_column(String(255))
    job_type: Mapped[str] = mapped_column(String(50), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)

    frequency: Mapped[ScheduleFrequency] = mapped_column(Enum(ScheduleFrequency, name="schedule_frequency"))
    run_at_hour: Mapped[int] = mapped_column(Integer, default=7)
    day_of_week: Mapped[int | None] = mapped_column(Integer)
    interval_minutes: Mapped[int | None] = mapped_column(Integer)

    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    workspace: Mapped["Workspace"] = relationship()
    created_by_user: Mapped["User | None"] = relationship(foreign_keys=[created_by_user_id])
    last_job: Mapped["Job | None"] = relationship(foreign_keys=[last_job_id])
