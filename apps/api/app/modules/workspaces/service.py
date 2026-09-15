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
    if "name" in data.model_fields_set and data.name is not None:
        workspace.name = data.name
    if "currency" in data.model_fields_set and data.currency is not None:
        workspace.currency = data.currency
    if "timezone" in data.model_fields_set and data.timezone is not None:
        workspace.timezone = data.timezone
    db.commit()
    db.refresh(workspace)
    return workspace
