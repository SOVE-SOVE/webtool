import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.design_briefs import service
from app.modules.design_briefs.schemas import BriefIntakeStart, BriefRead, BriefUpdate
from app.modules.users.models import User

router = APIRouter(tags=["design-briefs"])


@router.post("/api/v1/clients/{client_id}/intake", response_model=BriefRead, status_code=201)
def start_intake(
    client_id: uuid.UUID,
    data: BriefIntakeStart,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BriefRead:
    brief = service.start_intake(db, current_user.workspace_id, current_user.id, client_id, data)
    if brief is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return brief


@router.get("/api/v1/projects/{project_id}/brief", response_model=BriefRead)
def get_brief(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BriefRead:
    brief = service.get_brief(db, current_user.workspace_id, project_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return brief


@router.patch("/api/v1/projects/{project_id}/brief", response_model=BriefRead)
def update_brief(
    project_id: uuid.UUID,
    data: BriefUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BriefRead:
    brief = service.update_brief(db, current_user.workspace_id, current_user.id, project_id, data)
    if brief is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return brief


@router.post("/api/v1/projects/{project_id}/brief/approve", response_model=BriefRead)
def approve_brief(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BriefRead:
    brief = service.approve_brief(db, current_user.workspace_id, current_user.id, project_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return brief
