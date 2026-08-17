import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.leads import service as leads_service
from app.modules.users.models import User
from app.modules.website_audits import service
from app.modules.website_audits.schemas import WebsiteAuditRead

router = APIRouter(prefix="/api/v1/leads/{lead_id}/website-audits", tags=["website-audits"])


@router.get("", response_model=list[WebsiteAuditRead])
def list_website_audits(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WebsiteAuditRead]:
    if leads_service.get_lead(db, current_user.workspace_id, lead_id) is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return service.list_website_audits(db, current_user.workspace_id, lead_id)
