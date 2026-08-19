import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.creative_directions import service
from app.modules.creative_directions.schemas import (
    CreativeDirectionRead,
    CreativeDirectionUpdate,
    GenerateCreativeDirectionRequest,
)
from app.modules.projects import service as projects_service
from app.modules.users.models import User

router = APIRouter(tags=["creative-directions"])


@router.post(
    "/api/v1/projects/{project_id}/creative-directions",
    response_model=CreativeDirectionRead,
    status_code=201,
)
def generate_creative_direction(
    project_id: uuid.UUID,
    body: GenerateCreativeDirectionRequest = GenerateCreativeDirectionRequest(),
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> CreativeDirectionRead:
    brief = service.generate_creative_direction(db, current_user.workspace_id, current_user.id, project_id, body)
    if brief is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return brief


@router.get(
    "/api/v1/projects/{project_id}/creative-directions",
    response_model=list[CreativeDirectionRead],
)
def list_creative_directions(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CreativeDirectionRead]:
    if projects_service.get_project(db, current_user.workspace_id, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return service.list_creative_directions(db, current_user.workspace_id, project_id)


@router.get("/api/v1/creative-directions/{brief_id}", response_model=CreativeDirectionRead)
def get_creative_direction(
    brief_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CreativeDirectionRead:
    brief = service.get_creative_direction(db, current_user.workspace_id, brief_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Creative direction not found")
    return brief


@router.patch("/api/v1/creative-directions/{brief_id}", response_model=CreativeDirectionRead)
def update_creative_direction(
    brief_id: uuid.UUID,
    data: CreativeDirectionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CreativeDirectionRead:
    brief = service.update_creative_direction(db, current_user.workspace_id, current_user.id, brief_id, data)
    if brief is None:
        raise HTTPException(status_code=404, detail="Creative direction not found")
    return brief


@router.post("/api/v1/creative-directions/{brief_id}/approve", response_model=CreativeDirectionRead)
def approve_creative_direction(
    brief_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CreativeDirectionRead:
    brief = service.approve_creative_direction(db, current_user.workspace_id, current_user.id, brief_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Creative direction not found")
    return brief
