import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.leads import service as leads_service
from app.modules.sales_audits import service
from app.modules.sales_audits.schemas import SalesAuditRead
from app.modules.users.models import User

router = APIRouter(tags=["sales-audits"])


@router.post("/api/v1/leads/{lead_id}/sales-audits", response_model=SalesAuditRead, status_code=201)
def generate_sales_audit(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SalesAuditRead:
    report = service.generate_sales_audit(db, current_user.workspace_id, current_user.id, lead_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return report


@router.get("/api/v1/leads/{lead_id}/sales-audits", response_model=list[SalesAuditRead])
def list_sales_audits(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SalesAuditRead]:
    if leads_service.get_lead(db, current_user.workspace_id, lead_id) is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return service.list_sales_audits(db, current_user.workspace_id, lead_id)


@router.get("/api/v1/sales-audits/{audit_id}", response_model=SalesAuditRead)
def get_sales_audit(
    audit_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SalesAuditRead:
    report = service.get_sales_audit(db, current_user.workspace_id, audit_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Sales audit not found")
    return report
