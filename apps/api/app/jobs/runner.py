"""
In-process job poller, per docs/02_ARCHITECTURE.md §4. Not wired to
auto-start anywhere — a deployment that needs jobs actually processed
runs this as its own process (`python -m app.jobs.runner`), same
pattern as `python -m app.core.seed` (`scripts/start-mac.sh` starts it
alongside the API/web app for local development). `handlers.py` is
where every job_type the automation pipeline uses (discovery/research/
audit/score, outreach/follow-up drafting, website generation, QA) gets
registered — see that module for what each one does and why it's safe
to run unattended.
"""

import time
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.logging import logger
from app.db import all_models  # noqa: F401 — registers every model before mappers configure
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
    from app.jobs.handlers import HANDLERS

    poll_forever(handlers=HANDLERS)
