import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.users.models import User
from app.modules.website_revisions import service
from app.modules.website_revisions.schemas import DecisionRequest, RequestRevisionRequest, WebsiteRevisionRead

router = APIRouter(tags=["website-revisions"])

# Rate-limited like sitemaps/creative_directions — a "content" kind
# revision calls the LLM (agents/website_revision.py); a "spacing" kind
# doesn't, but the split isn't known until the request is inspected, so
# this endpoint is limited uniformly rather than letting spacing-only
# feedback quietly bypass the same generation budget.
@router.post("/api/v1/websites/{website_id}/revisions", response_model=WebsiteRevisionRead, status_code=201)
def request_revision(
    website_id: uuid.UUID,
    body: RequestRevisionRequest,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> WebsiteRevisionRead:
    revision = service.request_revision(db, current_user.workspace_id, current_user.id, website_id, body)
    if revision is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return revision


@router.get("/api/v1/websites/{website_id}/revisions", response_model=list[WebsiteRevisionRead])
def list_revisions_for_website(
    website_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WebsiteRevisionRead]:
    revisions = service.list_revisions_for_website(db, current_user.workspace_id, website_id)
    if revisions is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return revisions


@router.get("/api/v1/revisions/{revision_id}", response_model=WebsiteRevisionRead)
def get_revision(
    revision_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRevisionRead:
    revision = service.get_revision(db, current_user.workspace_id, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    return revision


@router.post("/api/v1/revisions/{revision_id}/approve", response_model=WebsiteRevisionRead)
def approve_revision(
    revision_id: uuid.UUID,
    body: DecisionRequest = DecisionRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRevisionRead:
    revision = service.approve_revision(db, current_user.workspace_id, current_user.id, revision_id, body)
    if revision is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    return revision


@router.post("/api/v1/revisions/{revision_id}/rollback", response_model=WebsiteRevisionRead)
def rollback_revision(
    revision_id: uuid.UUID,
    body: DecisionRequest = DecisionRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRevisionRead:
    revision = service.rollback_revision(db, current_user.workspace_id, current_user.id, revision_id, body)
    if revision is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    return revision
