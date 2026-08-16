from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin
from app.db.session import get_db
from app.modules.users.models import User
from app.modules.workspaces import service
from app.modules.workspaces.schemas import WorkspaceRead, WorkspaceUpdate

router = APIRouter(prefix="/api/v1/workspace", tags=["workspace"])


@router.get("", response_model=WorkspaceRead)
def get_workspace(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> WorkspaceRead:
    workspace = service.get_workspace(db, current_user.workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


@router.patch("", response_model=WorkspaceRead)
def update_workspace(
    data: WorkspaceUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> WorkspaceRead:
    """Admin-only, per docs/01_REQUIREMENTS.md's ADMIN role: manage workspace settings."""
    workspace = service.update_workspace(db, current_user.workspace_id, data)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace
