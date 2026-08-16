import uuid

from sqlalchemy.orm import Session

from app.modules.workspaces.models import Workspace
from app.modules.workspaces.schemas import WorkspaceUpdate


def get_workspace(db: Session, workspace_id: uuid.UUID) -> Workspace | None:
    return db.get(Workspace, workspace_id)


def update_workspace(db: Session, workspace_id: uuid.UUID, data: WorkspaceUpdate) -> Workspace | None:
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        return None
    workspace.name = data.name
    db.commit()
    db.refresh(workspace)
    return workspace
