import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.jobs.models import TERMINAL_JOB_STATUSES, Job, JobSchedule, JobStatus, ScheduleFrequency


class JobCancelled(Exception):
    """
    Raised by a handler that cooperatively checked `is_cancel_requested`
    mid-run and is stopping early — caught specifically by
    `app/jobs/runner.py::run_once` so the job lands in CANCELLED rather
    than FAILED (and is never retried, unlike a genuine failure).
    """


class CannotCancelError(ValueError):
    """Raised by request_cancel on a job already in a terminal state."""


def enqueue(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    job_type: str,
    payload: dict,
    actor_id: uuid.UUID | None = None,
    run_after: datetime | None = None,
    max_attempts: int = 3,
) -> Job:
    """
    Stages (and commits) a new PENDING job. Committing here rather than
    leaving it to the caller is deliberate — unlike activity_log.record,
    a job is meaningful on its own (something else polls for it), not
    just a side effect riding along another entity's transaction.
    """
    job = Job(
        workspace_id=workspace_id,
        created_by_user_id=actor_id,
        job_type=job_type,
        payload=payload,
        run_after=run_after or datetime.now(timezone.utc),
        max_attempts=max_attempts,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def claim_next(db: Session, *, job_type: str | None = None) -> Job | None:
    """
    Locks and returns the oldest due PENDING job, marking it RUNNING in
    the same transaction — `FOR UPDATE SKIP LOCKED` so more than one
    poller process can run concurrently without two workers claiming the
    same row. Returns None when nothing is due yet. A CANCELLED job is
    never PENDING, so it's never claimed — cancellation before pickup is
    just as effective as cancellation itself.
    """
    query = (
        select(Job)
        .where(Job.status == JobStatus.PENDING, Job.run_after <= datetime.now(timezone.utc))
        .order_by(Job.run_after.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if job_type is not None:
        query = query.where(Job.job_type == job_type)

    job = db.scalar(query)
    if job is None:
        return None

    job.status = JobStatus.RUNNING
    job.attempts += 1
    job.started_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return job


def mark_done(db: Session, job: Job, result: dict | None = None) -> Job:
    job.status = JobStatus.DONE
    job.result = result
    job.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return job


def mark_failed(db: Session, job: Job, error_message: str) -> Job:
    """
    Retries (back to PENDING) while attempts remain under the cap,
    otherwise leaves it FAILED for good — same shape as any at-least-once
    queue, without needing a dead-letter table for a single-operator
    system at this volume.
    """
    job.error_message = error_message
    if job.attempts < job.max_attempts:
        job.status = JobStatus.PENDING
    else:
        job.status = JobStatus.FAILED
        job.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return job


def mark_cancelled(db: Session, job: Job, message: str | None = None) -> Job:
    job.status = JobStatus.CANCELLED
    job.error_message = message
    job.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return job


def request_cancel(db: Session, workspace_id: uuid.UUID, job_id: uuid.UUID) -> Job | None:
    """
    A PENDING job is cancelled immediately (it will never be claimed —
    see claim_next). A RUNNING job is only flagged; it lands in
    CANCELLED once its handler notices (via is_cancel_requested) and
    raises JobCancelled, or simply runs to completion if it never
    checks. Returns None when the job doesn't exist in this workspace,
    so the route can 404.
    """
    job = db.scalar(select(Job).where(Job.workspace_id == workspace_id, Job.id == job_id))
    if job is None:
        return None
    if job.status in TERMINAL_JOB_STATUSES:
        raise CannotCancelError(f"Job is already {job.status.value} — nothing to cancel")

    if job.status == JobStatus.PENDING:
        return mark_cancelled(db, job, "Cancelled before it started running")

    job.cancel_requested = True
    db.commit()
    db.refresh(job)
    return job


def is_cancel_requested(db: Session, job_id: uuid.UUID) -> bool:
    """
    A fresh, cheap read of just the flag — not the cached in-memory `Job`
    a long-running handler may be holding onto — so a cancel requested by
    a concurrent request is actually seen mid-loop.
    """
    return bool(db.scalar(select(Job.cancel_requested).where(Job.id == job_id)))


def append_log(db: Session, job: Job, message: str, level: str = "info") -> Job:
    """
    Appends one structured progress entry and commits immediately, so the
    log is visible via the API while the job is still RUNNING, not only
    after it finishes. `logs` is reassigned (not mutated in place) since
    SQLAlchemy's JSON type doesn't track in-place list mutation.
    """
    job.logs = [*job.logs, {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "message": message}]
    db.commit()
    db.refresh(job)
    return job


def get_job(db: Session, workspace_id: uuid.UUID, job_id: uuid.UUID) -> Job | None:
    return db.scalar(select(Job).where(Job.workspace_id == workspace_id, Job.id == job_id))


def list_jobs(
    db: Session,
    workspace_id: uuid.UUID,
    job_type: str | None = None,
    status: JobStatus | None = None,
) -> list[Job]:
    query = select(Job).where(Job.workspace_id == workspace_id)
    if job_type is not None:
        query = query.where(Job.job_type == job_type)
    if status is not None:
        query = query.where(Job.status == status)
    return list(db.scalars(query.order_by(Job.created_at.desc())))


# --- Schedules ---------------------------------------------------------


def compute_next_run_at(
    frequency: ScheduleFrequency,
    *,
    run_at_hour: int,
    day_of_week: int | None,
    interval_minutes: int | None,
    after: datetime,
) -> datetime:
    """
    Pure function so the scheduling math is unit-testable without a
    database. `after` is normally "now" (first schedule) or the
    schedule's own previous `next_run_at` (subsequent runs), which keeps
    the cadence anchored to the configured time-of-day instead of
    drifting forward by however late the poller happened to run.
    """
    if frequency == ScheduleFrequency.HOURLY:
        return after + timedelta(minutes=interval_minutes or 60)

    target_hour = run_at_hour % 24
    candidate = after.replace(hour=target_hour, minute=0, second=0, microsecond=0)
    if candidate <= after:
        candidate += timedelta(days=1)

    if frequency == ScheduleFrequency.WEEKLY:
        target_day = day_of_week if day_of_week is not None else candidate.weekday()
        days_ahead = (target_day - candidate.weekday()) % 7
        candidate += timedelta(days=days_ahead)

    return candidate


def create_schedule(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    name: str | None,
    job_type: str,
    payload: dict,
    frequency: ScheduleFrequency,
    run_at_hour: int = 7,
    day_of_week: int | None = None,
    interval_minutes: int | None = None,
    max_attempts: int = 3,
) -> JobSchedule:
    now = datetime.now(timezone.utc)
    schedule = JobSchedule(
        workspace_id=workspace_id,
        created_by_user_id=actor_id,
        name=name,
        job_type=job_type,
        payload=payload,
        frequency=frequency,
        run_at_hour=run_at_hour,
        day_of_week=day_of_week,
        interval_minutes=interval_minutes,
        max_attempts=max_attempts,
        next_run_at=compute_next_run_at(
            frequency, run_at_hour=run_at_hour, day_of_week=day_of_week, interval_minutes=interval_minutes, after=now
        ),
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


def list_schedules(db: Session, workspace_id: uuid.UUID, job_type: str | None = None) -> list[JobSchedule]:
    query = select(JobSchedule).where(JobSchedule.workspace_id == workspace_id)
    if job_type is not None:
        query = query.where(JobSchedule.job_type == job_type)
    return list(db.scalars(query.order_by(JobSchedule.created_at.desc())))


def get_schedule(db: Session, workspace_id: uuid.UUID, schedule_id: uuid.UUID) -> JobSchedule | None:
    return db.scalar(
        select(JobSchedule).where(JobSchedule.workspace_id == workspace_id, JobSchedule.id == schedule_id)
    )


def update_schedule(
    db: Session,
    schedule: JobSchedule,
    *,
    name: str | None = None,
    payload: dict | None = None,
    frequency: ScheduleFrequency | None = None,
    run_at_hour: int | None = None,
    day_of_week: int | None = None,
    interval_minutes: int | None = None,
    is_enabled: bool | None = None,
) -> JobSchedule:
    if name is not None:
        schedule.name = name
    if payload is not None:
        schedule.payload = payload
    if frequency is not None:
        schedule.frequency = frequency
    if run_at_hour is not None:
        schedule.run_at_hour = run_at_hour
    if day_of_week is not None:
        schedule.day_of_week = day_of_week
    if interval_minutes is not None:
        schedule.interval_minutes = interval_minutes
    if is_enabled is not None:
        schedule.is_enabled = is_enabled

    # Any change to the recurrence shape re-anchors next_run_at from now,
    # rather than leaving a stale time computed under the old settings.
    if frequency is not None or run_at_hour is not None or day_of_week is not None or interval_minutes is not None:
        schedule.next_run_at = compute_next_run_at(
            schedule.frequency,
            run_at_hour=schedule.run_at_hour,
            day_of_week=schedule.day_of_week,
            interval_minutes=schedule.interval_minutes,
            after=datetime.now(timezone.utc),
        )

    db.commit()
    db.refresh(schedule)
    return schedule


def delete_schedule(db: Session, schedule: JobSchedule) -> None:
    db.delete(schedule)
    db.commit()


def run_schedule_now(db: Session, schedule: JobSchedule) -> Job:
    """Enqueues one job immediately from this schedule's own configuration,
    without disturbing its regular next_run_at cadence."""
    job = enqueue(
        db,
        workspace_id=schedule.workspace_id,
        job_type=schedule.job_type,
        payload=schedule.payload,
        actor_id=schedule.created_by_user_id,
        max_attempts=schedule.max_attempts,
    )
    schedule.last_run_at = datetime.now(timezone.utc)
    schedule.last_job_id = job.id
    db.commit()
    return job


def materialize_due_schedules(db: Session) -> list[Job]:
    """
    Enqueues one Job per due, enabled schedule (across every workspace —
    the scheduler is a single global tick, same as the job poller) and
    advances each one's `next_run_at`. Called every poller tick from
    `app/jobs/runner.py`; cheap when nothing is due (one indexed query).
    """
    now = datetime.now(timezone.utc)
    due = list(db.scalars(select(JobSchedule).where(JobSchedule.is_enabled.is_(True), JobSchedule.next_run_at <= now)))

    jobs: list[Job] = []
    for schedule in due:
        job = enqueue(
            db,
            workspace_id=schedule.workspace_id,
            job_type=schedule.job_type,
            payload=schedule.payload,
            actor_id=schedule.created_by_user_id,
            max_attempts=schedule.max_attempts,
        )
        schedule.last_run_at = now
        schedule.last_job_id = job.id
        schedule.next_run_at = compute_next_run_at(
            schedule.frequency,
            run_at_hour=schedule.run_at_hour,
            day_of_week=schedule.day_of_week,
            interval_minutes=schedule.interval_minutes,
            after=schedule.next_run_at,
        )
        db.commit()
        jobs.append(job)
    return jobs
