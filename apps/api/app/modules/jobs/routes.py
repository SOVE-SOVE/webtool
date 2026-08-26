import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.jobs import service
from app.modules.jobs.models import JobStatus
from app.modules.jobs.schemas import JobRead, JobScheduleCreate, JobScheduleRead, JobScheduleUpdate
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.get("", response_model=list[JobRead])
def list_jobs(
    job_type: str | None = None,
    status: JobStatus | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[JobRead]:
    return service.list_jobs(db, current_user.workspace_id, job_type=job_type, status=status)


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> JobRead:
    job = service.get_job(db, current_user.workspace_id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/{job_id}/cancel", response_model=JobRead)
def cancel_job(
    job_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> JobRead:
    try:
        job = service.request_cancel(db, current_user.workspace_id, job_id)
    except service.CannotCancelError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


schedules_router = APIRouter(prefix="/api/v1/job-schedules", tags=["jobs"])


@schedules_router.get("", response_model=list[JobScheduleRead])
def list_schedules(
    job_type: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[JobScheduleRead]:
    return service.list_schedules(db, current_user.workspace_id, job_type=job_type)


@schedules_router.post("", response_model=JobScheduleRead, status_code=201)
def create_schedule(
    data: JobScheduleCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> JobScheduleRead:
    return service.create_schedule(
        db,
        workspace_id=current_user.workspace_id,
        actor_id=current_user.id,
        name=data.name,
        job_type=data.job_type,
        payload=data.payload,
        frequency=data.frequency,
        run_at_hour=data.run_at_hour,
        day_of_week=data.day_of_week,
        interval_minutes=data.interval_minutes,
        max_attempts=data.max_attempts,
    )


@schedules_router.get("/{schedule_id}", response_model=JobScheduleRead)
def get_schedule(
    schedule_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> JobScheduleRead:
    schedule = service.get_schedule(db, current_user.workspace_id, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Job schedule not found")
    return schedule


@schedules_router.patch("/{schedule_id}", response_model=JobScheduleRead)
def update_schedule(
    schedule_id: uuid.UUID,
    data: JobScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> JobScheduleRead:
    schedule = service.get_schedule(db, current_user.workspace_id, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Job schedule not found")
    return service.update_schedule(
        db,
        schedule,
        name=data.name,
        payload=data.payload,
        frequency=data.frequency,
        run_at_hour=data.run_at_hour,
        day_of_week=data.day_of_week,
        interval_minutes=data.interval_minutes,
        is_enabled=data.is_enabled,
    )


@schedules_router.delete("/{schedule_id}", status_code=204)
def delete_schedule(
    schedule_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    schedule = service.get_schedule(db, current_user.workspace_id, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Job schedule not found")
    service.delete_schedule(db, schedule)


@schedules_router.post("/{schedule_id}/run-now", response_model=JobRead, status_code=201)
def run_schedule_now(
    schedule_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> JobRead:
    schedule = service.get_schedule(db, current_user.workspace_id, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Job schedule not found")
    return service.run_schedule_now(db, schedule)
