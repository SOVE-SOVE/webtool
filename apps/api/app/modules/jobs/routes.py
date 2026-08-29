import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.jobs import service
from app.modules.jobs.schemas import JobRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.get("", response_model=list[JobRead])
def list_jobs(
    job_type: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[JobRead]:
    """The background automation queue — every stage-to-stage hand-off
    (discovery -> research -> analysis -> scoring, outreach/follow-up
    drafting, website generation, QA) runs through a row here, so this is
    the one place to see what the automation has done or is about to do,
    across every module it touches."""
    return service.list_jobs(db, current_user.workspace_id, job_type=job_type)


@router.get("/{job_id}", response_model=JobRead)
def get_job(
    job_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> JobRead:
    job = service.get_job(db, current_user.workspace_id, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
