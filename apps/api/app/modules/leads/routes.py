import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.leads import service
from app.modules.leads.schemas import LeadCreate, LeadRead, LeadUpdate
from app.modules.pipeline import service as pipeline_service
from app.modules.pipeline.schemas import PipelineEventRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/leads", tags=["leads"])


@router.get("", response_model=list[LeadRead])
def list_leads(
    include_archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[LeadRead]:
    return service.list_leads(db, current_user.workspace_id, include_archived=include_archived)


@router.post("", response_model=LeadRead, status_code=201)
def create_lead(
    data: LeadCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LeadRead:
    return service.create_lead(db, current_user.workspace_id, current_user.id, data)


@router.get("/{lead_id}", response_model=LeadRead)
def get_lead(
    lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LeadRead:
    lead = service.get_lead(db, current_user.workspace_id, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.patch("/{lead_id}", response_model=LeadRead)
def update_lead(
    lead_id: uuid.UUID,
    data: LeadUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LeadRead:
    lead = service.update_lead(db, current_user.workspace_id, current_user.id, lead_id, data)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.post("/{lead_id}/archive", response_model=LeadRead)
def archive_lead(
    lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LeadRead:
    lead = service.archive_lead(db, current_user.workspace_id, current_user.id, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.post("/{lead_id}/unarchive", response_model=LeadRead)
def unarchive_lead(
    lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LeadRead:
    lead = service.unarchive_lead(db, current_user.workspace_id, current_user.id, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.get("/{lead_id}/pipeline-events", response_model=list[PipelineEventRead])
def list_lead_pipeline_events(
    lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[PipelineEventRead]:
    """Newest first — the stage-transition history behind a lead's
    current status, per docs/04_ROADMAP.md Phase 3."""
    events = pipeline_service.list_lead_events(db, current_user.workspace_id, lead_id)
    if events is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return events
