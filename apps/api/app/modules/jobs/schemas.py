import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.jobs.models import JobStatus, ScheduleFrequency


class JobLogEntry(BaseModel):
    ts: datetime
    level: str
    message: str


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_type: str
    status: JobStatus
    payload: dict
    result: dict | None
    error_message: str | None
    logs: list[JobLogEntry]
    cancel_requested: bool
    attempts: int
    max_attempts: int
    run_after: datetime
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class JobScheduleCreate(BaseModel):
    name: str | None = None
    job_type: str
    payload: dict = {}
    frequency: ScheduleFrequency
    run_at_hour: int = 7
    day_of_week: int | None = None
    interval_minutes: int | None = None
    max_attempts: int = 3


class JobScheduleUpdate(BaseModel):
    name: str | None = None
    payload: dict | None = None
    frequency: ScheduleFrequency | None = None
    run_at_hour: int | None = None
    day_of_week: int | None = None
    interval_minutes: int | None = None
    is_enabled: bool | None = None


class JobScheduleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    job_type: str
    payload: dict
    frequency: ScheduleFrequency
    run_at_hour: int
    day_of_week: int | None
    interval_minutes: int | None
    max_attempts: int
    is_enabled: bool
    next_run_at: datetime
    last_run_at: datetime | None
    last_job_id: uuid.UUID | None
    created_at: datetime
