import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.sales_opportunities import service
from app.modules.sales_opportunities.schemas import SalesOpportunityCreate, SalesOpportunityRead
from app.modules.users.models import User

router = APIRouter(tags=["sales_opportunities"])


@router.post("/api/v1/leads/{lead_id}/opportunities", response_model=SalesOpportunityRead, status_code=201)
def create_opportunity(
    lead_id: uuid.UUID,
    data: SalesOpportunityCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SalesOpportunityRead:
    opportunity = service.create_opportunity(db, current_user.workspace_id, current_user.id, lead_id, data)
    if opportunity is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return opportunity


@router.get("/api/v1/leads/{lead_id}/opportunities", response_model=list[SalesOpportunityRead])
def list_opportunities(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SalesOpportunityRead]:
    opportunities = service.list_for_lead(db, current_user.workspace_id, lead_id)
    if opportunities is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return opportunities


@router.post("/api/v1/opportunities/{opportunity_id}/mark-lost", response_model=SalesOpportunityRead)
def mark_opportunity_lost(
    opportunity_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SalesOpportunityRead:
    opportunity = service.mark_opportunity_lost(db, current_user.workspace_id, current_user.id, opportunity_id)
    if opportunity is None:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return opportunity
