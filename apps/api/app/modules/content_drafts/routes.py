import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.content_drafts import service
from app.modules.content_drafts.schemas import (
    ApproveContentDraftRequest,
    ContentDraftRead,
    ContentDraftSummary,
    ContentPageUpdate,
    GenerateContentDraftRequest,
)
from app.modules.projects import service as projects_service
from app.modules.users.models import User

router = APIRouter(tags=["content-drafts"])


@router.post("/api/v1/projects/{project_id}/content-drafts", response_model=ContentDraftRead, status_code=201)
def generate_content_draft(
    project_id: uuid.UUID,
    body: GenerateContentDraftRequest = GenerateContentDraftRequest(),
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = service.generate_content_draft(db, current_user.workspace_id, current_user.id, project_id, body)
    if draft is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return draft


@router.get("/api/v1/projects/{project_id}/content-drafts", response_model=list[ContentDraftSummary])
def list_content_drafts(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ContentDraftSummary]:
    if projects_service.get_project(db, current_user.workspace_id, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return service.list_content_drafts(db, current_user.workspace_id, project_id)


@router.get("/api/v1/content-drafts/{draft_id}", response_model=ContentDraftRead)
def get_content_draft(
    draft_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = service.get_content_draft(db, current_user.workspace_id, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Content draft not found")
    return draft


@router.patch("/api/v1/content-drafts/{draft_id}/pages/{page_id}", response_model=ContentDraftRead)
def update_content_draft_page(
    draft_id: uuid.UUID,
    page_id: str,
    data: ContentPageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = service.update_page(db, current_user.workspace_id, current_user.id, draft_id, page_id, data)
    if draft is None:
        raise HTTPException(status_code=404, detail="Content draft not found")
    return draft


@router.post("/api/v1/content-drafts/{draft_id}/approve", response_model=ContentDraftRead)
def approve_content_draft(
    draft_id: uuid.UUID,
    body: ApproveContentDraftRequest = ApproveContentDraftRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = service.approve_content_draft(db, current_user.workspace_id, current_user.id, draft_id, body)
    if draft is None:
        raise HTTPException(status_code=404, detail="Content draft not found")
    return draft


@router.post("/api/v1/content-drafts/{draft_id}/rollback", response_model=ContentDraftRead, status_code=201)
def rollback_content_draft(
    draft_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentDraftRead:
    draft = service.rollback_content_draft(db, current_user.workspace_id, current_user.id, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Content draft not found")
    return draft
