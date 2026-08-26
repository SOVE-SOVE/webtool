import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.projects import service as projects_service
from app.modules.users.models import User
from app.modules.website_briefs import service
from app.modules.website_briefs.schemas import (
    GenerateWebsiteBriefRequest,
    WebsiteBriefRead,
    WebsiteBriefUpdate,
)

router = APIRouter(tags=["website-briefs"])


@router.post(
    "/api/v1/projects/{project_id}/website-briefs",
    response_model=WebsiteBriefRead,
    status_code=201,
)
def generate_website_brief(
    project_id: uuid.UUID,
    body: GenerateWebsiteBriefRequest = GenerateWebsiteBriefRequest(),
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> WebsiteBriefRead:
    brief = service.generate_website_brief(db, current_user.workspace_id, current_user.id, project_id, body)
    if brief is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return brief


@router.get(
    "/api/v1/projects/{project_id}/website-briefs",
    response_model=list[WebsiteBriefRead],
)
def list_website_briefs(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WebsiteBriefRead]:
    if projects_service.get_project(db, current_user.workspace_id, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return service.list_website_briefs(db, current_user.workspace_id, project_id)


@router.get("/api/v1/website-briefs/{brief_id}", response_model=WebsiteBriefRead)
def get_website_brief(
    brief_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteBriefRead:
    brief = service.get_website_brief(db, current_user.workspace_id, brief_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Website brief not found")
    return brief


@router.patch("/api/v1/website-briefs/{brief_id}", response_model=WebsiteBriefRead)
def update_website_brief(
    brief_id: uuid.UUID,
    data: WebsiteBriefUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteBriefRead:
    brief = service.update_website_brief(db, current_user.workspace_id, current_user.id, brief_id, data)
    if brief is None:
        raise HTTPException(status_code=404, detail="Website brief not found")
    return brief


@router.post("/api/v1/website-briefs/{brief_id}/approve", response_model=WebsiteBriefRead)
def approve_website_brief(
    brief_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteBriefRead:
    brief = service.approve_website_brief(db, current_user.workspace_id, current_user.id, brief_id)
    if brief is None:
        raise HTTPException(status_code=404, detail="Website brief not found")
    return brief
