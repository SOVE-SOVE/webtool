import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.jobs.models import JobStatus


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_type: str
    status: JobStatus
    payload: dict
    result: dict | None
    error_message: str | None
    attempts: int
    max_attempts: int
    run_after: datetime
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
