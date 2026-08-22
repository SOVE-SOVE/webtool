import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, func
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


class Job(Base):
    """
    Background-work queue, per docs/02_ARCHITECTURE.md §4 ("a job table,
    not Celery/Redis") — designed there but never actually built until
    this pass. A row is the durability mechanism: an in-process poller
    (app/jobs/runner.py) claims PENDING rows via `SELECT ... FOR UPDATE
    SKIP LOCKED`, so it survives a process restart and tolerates more
    than one poller running at once without double-processing a job.

    `run_after` defaults to now (run ASAP) but can be set in the future,
    which is what makes *scheduled* discovery possible later — an
    operator or a cron-triggered enqueuer inserts a `discovery_search`
    job with `run_after` set to the next scheduled time; no schema change
    needed when that scheduler is actually built. Nothing in this pass
    auto-starts the poller or wires a scheduler — the queue is the
    architecture piece, per the Lead Intelligence spec's "must support
    future scheduled discovery."
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

    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    workspace: Mapped["Workspace"] = relationship()
    created_by_user: Mapped["User | None"] = relationship()
