import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import require_operator
from app.db.session import get_db
from app.modules.leads import service
from app.modules.leads.schemas import LeadCreate, LeadRead, LeadUpdate

router = APIRouter(prefix="/api/v1/leads", tags=["leads"], dependencies=[Depends(require_operator)])


@router.get("", response_model=list[LeadRead])
def list_leads(db: Session = Depends(get_db)) -> list[LeadRead]:
    return service.list_leads(db)


@router.post("", response_model=LeadRead, status_code=201)
def create_lead(data: LeadCreate, db: Session = Depends(get_db)) -> LeadRead:
    return service.create_lead(db, data)


@router.get("/{lead_id}", response_model=LeadRead)
def get_lead(lead_id: uuid.UUID, db: Session = Depends(get_db)) -> LeadRead:
    lead = service.get_lead(db, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.patch("/{lead_id}", response_model=LeadRead)
def update_lead(lead_id: uuid.UUID, data: LeadUpdate, db: Session = Depends(get_db)) -> LeadRead:
    lead = service.update_lead(db, lead_id, data)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead
