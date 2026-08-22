"""
In-process job poller, per docs/02_ARCHITECTURE.md §4. Not wired to
auto-start anywhere — a deployment that needs jobs actually processed
runs this as its own process (`python -m app.jobs.runner`), same
pattern as `python -m app.core.seed`. Nothing calls this yet; it exists
so `app.modules.jobs` is a real, runnable queue and not just a table,
ready for the first job type (e.g. a scheduled `discovery_search`
re-run) to register a handler.
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
    claimed (whether it succeeded or failed), False if the queue was
    empty — the caller decides whether to sleep before polling again.
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
        except Exception as exc:  # a handler bug must not crash the poller loop
            logger.exception("Job %s (%s) failed", job.id, job.job_type)
            jobs_service.mark_failed(db, job, str(exc))
        return True
    finally:
        db.close()


def poll_forever(handlers: dict[str, JobHandler], interval_seconds: float = POLL_INTERVAL_SECONDS) -> None:
    logger.info("Job poller started, handlers=%s", list(handlers))
    while True:
        claimed = run_once(handlers)
        if not claimed:
            time.sleep(interval_seconds)


if __name__ == "__main__":
    # No job types registered yet — the first real handler (e.g.
    # discovery_search) is added by the capability that needs
    # asynchronous/scheduled execution, per docs/04_ROADMAP.md.
    poll_forever(handlers={})
