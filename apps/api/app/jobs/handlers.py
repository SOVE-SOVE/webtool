"""
The poller's job_type -> handler registry (see `app/jobs/runner.py`).
Kept as its own module, imported only by the `__main__` entrypoint and
tests, so registering a new job type never means touching the poller
itself — a capability's own module owns its handler function; this file
just wires the string key to it.
"""

from typing import Callable

from sqlalchemy.orm import Session

from app.modules.jobs.models import Job

JobHandler = Callable[[Session, Job], dict | None]

HANDLERS: dict[str, JobHandler] = {}
