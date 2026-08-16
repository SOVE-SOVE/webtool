import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.users.models import User
from app.modules.website_audits import service
from app.modules.website_audits.schemas import WebsiteAuditRead

router = APIRouter(prefix="/api/v1/leads/{lead_id}/audits", tags=["website_audits"])


@router.get("", response_model=list[WebsiteAuditRead])
def list_audits(
    lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[WebsiteAuditRead]:
    audits = service.list_audits(db, current_user.workspace_id, lead_id)
    if audits is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return audits


@router.post("", response_model=WebsiteAuditRead, status_code=201)
def trigger_audit(
    lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> WebsiteAuditRead:
    return service.trigger_audit(db, current_user.workspace_id, current_user.id, lead_id)
