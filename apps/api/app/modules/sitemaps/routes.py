import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.projects import service as projects_service
from app.modules.sitemaps import service
from app.modules.sitemaps.schemas import (
    GenerateSitemapRequest,
    ReorderSitemapPagesRequest,
    SitemapPageCreate,
    SitemapPageUpdate,
    SitemapRead,
)
from app.modules.users.models import User

router = APIRouter(tags=["sitemaps"])


@router.post("/api/v1/projects/{project_id}/sitemaps", response_model=SitemapRead, status_code=201)
def generate_sitemap(
    project_id: uuid.UUID,
    body: GenerateSitemapRequest = GenerateSitemapRequest(),
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> SitemapRead:
    sitemap = service.generate_sitemap(db, current_user.workspace_id, current_user.id, project_id, body)
    if sitemap is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return sitemap


@router.get("/api/v1/projects/{project_id}/sitemaps", response_model=list[SitemapRead])
def list_sitemaps(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SitemapRead]:
    if projects_service.get_project(db, current_user.workspace_id, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return service.list_sitemaps(db, current_user.workspace_id, project_id)


@router.get("/api/v1/sitemaps/{sitemap_id}", response_model=SitemapRead)
def get_sitemap(
    sitemap_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SitemapRead:
    sitemap = service.get_sitemap(db, current_user.workspace_id, sitemap_id)
    if sitemap is None:
        raise HTTPException(status_code=404, detail="Sitemap not found")
    return sitemap


@router.post("/api/v1/sitemaps/{sitemap_id}/approve", response_model=SitemapRead)
def approve_sitemap(
    sitemap_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SitemapRead:
    sitemap = service.approve_sitemap(db, current_user.workspace_id, current_user.id, sitemap_id)
    if sitemap is None:
        raise HTTPException(status_code=404, detail="Sitemap not found")
    return sitemap


@router.post("/api/v1/sitemaps/{sitemap_id}/pages", response_model=SitemapRead, status_code=201)
def add_page(
    sitemap_id: uuid.UUID,
    data: SitemapPageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SitemapRead:
    sitemap = service.add_page(db, current_user.workspace_id, current_user.id, sitemap_id, data)
    if sitemap is None:
        raise HTTPException(status_code=404, detail="Sitemap not found")
    return sitemap


@router.patch("/api/v1/sitemaps/{sitemap_id}/pages/reorder", response_model=SitemapRead)
def reorder_pages(
    sitemap_id: uuid.UUID,
    data: ReorderSitemapPagesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SitemapRead:
    sitemap = service.reorder_pages(db, current_user.workspace_id, current_user.id, sitemap_id, data)
    if sitemap is None:
        raise HTTPException(status_code=404, detail="Sitemap not found")
    return sitemap


@router.patch("/api/v1/sitemaps/{sitemap_id}/pages/{page_id}", response_model=SitemapRead)
def update_page(
    sitemap_id: uuid.UUID,
    page_id: uuid.UUID,
    data: SitemapPageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SitemapRead:
    sitemap = service.update_page(db, current_user.workspace_id, current_user.id, sitemap_id, page_id, data)
    if sitemap is None:
        raise HTTPException(status_code=404, detail="Sitemap or page not found")
    return sitemap


@router.delete("/api/v1/sitemaps/{sitemap_id}/pages/{page_id}", response_model=SitemapRead)
def delete_page(
    sitemap_id: uuid.UUID,
    page_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SitemapRead:
    sitemap = service.delete_page(db, current_user.workspace_id, current_user.id, sitemap_id, page_id)
    if sitemap is None:
        raise HTTPException(status_code=404, detail="Sitemap or page not found")
    return sitemap
