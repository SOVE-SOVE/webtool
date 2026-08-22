import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.jobs.models import Job, JobStatus


def enqueue(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    job_type: str,
    payload: dict,
    actor_id: uuid.UUID | None = None,
    run_after: datetime | None = None,
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
    same row. Returns None when nothing is due yet.
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


def get_job(db: Session, workspace_id: uuid.UUID, job_id: uuid.UUID) -> Job | None:
    return db.scalar(select(Job).where(Job.workspace_id == workspace_id, Job.id == job_id))


def list_jobs(db: Session, workspace_id: uuid.UUID, job_type: str | None = None) -> list[Job]:
    query = select(Job).where(Job.workspace_id == workspace_id)
    if job_type is not None:
        query = query.where(Job.job_type == job_type)
    return list(db.scalars(query.order_by(Job.created_at.desc())))
