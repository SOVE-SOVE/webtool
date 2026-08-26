"""
In-process job poller and scheduler, per docs/02_ARCHITECTURE.md §4 — the
Phase 7 automation engine's single worker process. Not wired to
auto-start anywhere — a deployment that needs jobs actually processed
runs this as its own process (`python -m app.jobs.runner`), same pattern
as `python -m app.core.seed`.

Each tick does two things: materialize any due `JobSchedule` rows into
new PENDING jobs, then claim and process at most one due job. Handlers
are registered in `app/jobs/handlers.py`.
"""

import time
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.logging import logger
from app.db.session import SessionLocal
from app.modules.jobs import service as jobs_service
from app.modules.jobs.models import Job

POLL_INTERVAL_SECONDS = 5.0
JobHandler = Callable[[Session, Job], dict | None]


def run_once(handlers: dict[str, JobHandler]) -> bool:
    """
    Claims and processes at most one due job. Returns True if a job was
    claimed (whether it succeeded, failed, or was cancelled), False if
    the queue was empty — the caller decides whether to sleep before
    polling again.
    """
    db = SessionLocal()
    try:
        job = jobs_service.claim_next(db)
        if job is None:
            return False

        handler = handlers.get(job.job_type)
        if handler is None:
            jobs_service.mark_failed(db, job, f"No handler registered for job_type={job.job_type!r}")
            return True

        try:
            result = handler(db, job)
            jobs_service.mark_done(db, job, result)
        except jobs_service.JobCancelled as exc:
            logger.info("Job %s (%s) cancelled: %s", job.id, job.job_type, exc)
            jobs_service.mark_cancelled(db, job, str(exc) or "Cancelled")
        except Exception as exc:  # a handler bug must not crash the poller loop
            logger.exception("Job %s (%s) failed", job.id, job.job_type)
            jobs_service.mark_failed(db, job, str(exc))
        return True
    finally:
        db.close()


def tick(handlers: dict[str, JobHandler]) -> bool:
    """One scheduler-materialize + one job-claim, the poller's full unit of work."""
    db = SessionLocal()
    try:
        jobs_service.materialize_due_schedules(db)
    finally:
        db.close()
    return run_once(handlers)


def poll_forever(handlers: dict[str, JobHandler], interval_seconds: float = POLL_INTERVAL_SECONDS) -> None:
    logger.info("Job poller started, handlers=%s", list(handlers))
    while True:
        claimed = tick(handlers)
        if not claimed:
            time.sleep(interval_seconds)


if __name__ == "__main__":
    from app.jobs.handlers import HANDLERS

    poll_forever(handlers=HANDLERS)
