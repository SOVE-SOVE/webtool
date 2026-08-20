import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.approvals import service
from app.modules.approvals.schemas import ProjectApprovalStatus
from app.modules.users.models import User

router = APIRouter(tags=["approvals"])


@router.get("/api/v1/projects/{project_id}/approvals", response_model=ProjectApprovalStatus)
def get_project_approvals(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectApprovalStatus:
    status = service.get_project_approval_status(db, current_user.workspace_id, project_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return status
