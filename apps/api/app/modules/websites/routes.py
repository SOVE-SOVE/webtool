import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.projects import service as projects_service
from app.modules.users.models import User
from app.modules.websites import service
from app.modules.websites.schemas import (
    ApproveWebsiteRequest,
    GenerateWebsiteRequest,
    SectionUpdate,
    WebsiteRead,
    WebsiteSummary,
    WorkflowTransitionRead,
    WorkflowTransitionRequest,
)

router = APIRouter(tags=["websites"])

# No enforce_generation_rate_limit here (unlike sitemaps/creative-directions/
# outreach): agents/website_generator.py makes no LLM call, so there's no
# paid-API budget to protect — see docs/05_DECISIONS.md.


@router.post("/api/v1/projects/{project_id}/websites", response_model=WebsiteRead, status_code=201)
def generate_website(
    project_id: uuid.UUID,
    body: GenerateWebsiteRequest = GenerateWebsiteRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRead:
    website = service.generate_website(db, current_user.workspace_id, current_user.id, project_id, body)
    if website is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return website


@router.post("/api/v1/projects/{project_id}/initial-website", response_model=WebsiteRead, status_code=201)
def generate_initial_website(
    project_id: uuid.UUID,
    body: GenerateWebsiteRequest = GenerateWebsiteRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRead:
    """Generate the first ("prospect / demo") website for a project
    straight from the business information already on file — seeds a
    starter sitemap and pre-fills the brief on first run, then generates.
    The primary project workflow: build something to show the owner
    before they've lifted a finger."""
    website = service.generate_initial_website(db, current_user.workspace_id, current_user.id, project_id, body)
    if website is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return website


@router.get("/api/v1/projects/{project_id}/websites", response_model=list[WebsiteSummary])
def list_websites(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WebsiteSummary]:
    if projects_service.get_project(db, current_user.workspace_id, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return service.list_websites(db, current_user.workspace_id, project_id)


@router.get("/api/v1/websites/{website_id}", response_model=WebsiteRead)
def get_website(
    website_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRead:
    website = service.get_website(db, current_user.workspace_id, website_id)
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


@router.post("/api/v1/websites/{website_id}/sections/{section_id}/regenerate", response_model=WebsiteRead, status_code=201)
def regenerate_section(
    website_id: uuid.UUID,
    section_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRead:
    website = service.regenerate_section(db, current_user.workspace_id, current_user.id, website_id, section_id)
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


@router.patch("/api/v1/websites/{website_id}/sections/{section_id}", response_model=WebsiteRead)
def update_section(
    website_id: uuid.UUID,
    section_id: str,
    data: SectionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRead:
    website = service.update_section(db, current_user.workspace_id, current_user.id, website_id, section_id, data)
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


@router.post("/api/v1/websites/{website_id}/approve", response_model=WebsiteRead)
def approve_website(
    website_id: uuid.UUID,
    body: ApproveWebsiteRequest = ApproveWebsiteRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRead:
    website = service.approve_website(db, current_user.workspace_id, current_user.id, website_id, body)
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


@router.post("/api/v1/websites/{website_id}/client-approve", response_model=WebsiteRead)
def client_approve_website(
    website_id: uuid.UUID,
    body: ApproveWebsiteRequest = ApproveWebsiteRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRead:
    website = service.client_approve_website(db, current_user.workspace_id, current_user.id, website_id, body)
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


@router.post("/api/v1/websites/{website_id}/workflow-transition", response_model=WebsiteRead)
def transition_workflow(
    website_id: uuid.UUID,
    body: WorkflowTransitionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteRead:
    website = service.transition_website_workflow(db, current_user.workspace_id, current_user.id, website_id, body)
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return website


@router.get("/api/v1/websites/{website_id}/workflow-history", response_model=list[WorkflowTransitionRead])
def get_workflow_history(
    website_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WorkflowTransitionRead]:
    history = service.get_workflow_history(db, current_user.workspace_id, website_id)
    if history is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return history
