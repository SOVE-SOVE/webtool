import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_public_preview_rate_limit
from app.db.session import get_db
from app.modules.previews import service
from app.modules.previews.schemas import PreviewLinkCreate, PreviewLinkRead, PublicPreviewRead
from app.modules.users.models import User

router = APIRouter(tags=["previews"])


@router.post("/api/v1/projects/{project_id}/previews", response_model=PreviewLinkRead, status_code=201)
def create_preview_link(
    project_id: uuid.UUID,
    body: PreviewLinkCreate = PreviewLinkCreate(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PreviewLinkRead:
    link = service.create_preview_link(db, current_user.workspace_id, current_user.id, project_id, body)
    if link is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return link


@router.get("/api/v1/projects/{project_id}/previews", response_model=list[PreviewLinkRead])
def list_preview_links(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PreviewLinkRead]:
    links = service.list_preview_links(db, current_user.workspace_id, project_id)
    if links is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return links


@router.post("/api/v1/previews/{link_id}/revoke", response_model=PreviewLinkRead)
def revoke_preview_link(
    link_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PreviewLinkRead:
    link = service.revoke_preview_link(db, current_user.workspace_id, current_user.id, link_id)
    if link is None:
        raise HTTPException(status_code=404, detail="Preview link not found")
    return link


# --- Public: no auth dependency at all. The token in the URL is the
# credential — see modules/previews/service.py's resolve_preview. ---


@router.get("/api/v1/preview/{token}", response_model=PublicPreviewRead, dependencies=[Depends(enforce_public_preview_rate_limit)])
def get_preview(token: str, db: Session = Depends(get_db)) -> PublicPreviewRead:
    return service.resolve_preview(db, token, website_id=None)


@router.get(
    "/api/v1/preview/{token}/versions/{website_id}",
    response_model=PublicPreviewRead,
    dependencies=[Depends(enforce_public_preview_rate_limit)],
)
def get_preview_version(token: str, website_id: uuid.UUID, db: Session = Depends(get_db)) -> PublicPreviewRead:
    return service.resolve_preview(db, token, website_id=website_id)
