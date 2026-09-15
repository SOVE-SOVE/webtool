import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.projects import service
from app.modules.projects.schemas import (
    DeliveryStatusRead,
    ProjectChecklistSummary,
    ProjectCreate,
    ProjectRead,
    ProjectUpdate,
)
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
def list_projects(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ProjectRead]:
    return service.list_projects(db, current_user.workspace_id)


@router.post("", response_model=ProjectRead, status_code=201)
def create_project(
    data: ProjectCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProjectRead:
    return service.create_project(db, current_user.workspace_id, current_user.id, data)


# Registered ahead of the /{project_id} routes below — a fixed path
# segment like "checklist-summaries" would otherwise be matched as a
# (invalid) project_id by that route first, per FastAPI's in-order
# route matching (same convention as planning/routes.py).
@router.get("/checklist-summaries", response_model=list[ProjectChecklistSummary])
def list_project_checklist_summaries(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ProjectChecklistSummary]:
    return service.list_project_checklist_summaries(db, current_user.workspace_id)


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(
    project_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProjectRead:
    project = service.get_project(db, current_user.workspace_id, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project(
    project_id: uuid.UUID,
    data: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectRead:
    project = service.update_project(db, current_user.workspace_id, current_user.id, project_id, data)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/{project_id}/delivery-status", response_model=DeliveryStatusRead)
def get_delivery_status(
    project_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DeliveryStatusRead:
    status = service.get_delivery_status(db, current_user.workspace_id, project_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return status


@router.post("/{project_id}/deliver", response_model=ProjectRead)
def mark_delivered(
    project_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProjectRead:
    project = service.mark_delivered(db, current_user.workspace_id, current_user.id, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
