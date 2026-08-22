import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.discovery import service as discovery_service
from app.modules.users.models import User
from app.modules.website_quality import service
from app.modules.website_quality.schemas import WebsiteQualityAuditRead

router = APIRouter(prefix="/api/v1/discovered-businesses/{business_id}/quality-audits", tags=["website-quality"])


@router.get("", response_model=list[WebsiteQualityAuditRead])
def list_quality_audits(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[WebsiteQualityAuditRead]:
    if discovery_service.get_discovered_business(db, current_user.workspace_id, business_id) is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return service.list_quality_audits(db, business_id)


@router.post("", response_model=WebsiteQualityAuditRead, status_code=201)
def run_quality_audit(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> WebsiteQualityAuditRead:
    try:
        audit = service.run_quality_audit(db, current_user.workspace_id, current_user.id, business_id)
    except service.NoResearchAvailableError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if audit is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return audit
