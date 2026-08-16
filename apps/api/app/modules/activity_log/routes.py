import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.activity_log import service
from app.modules.activity_log.schemas import ActivityRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/activity", tags=["activity"])


@router.get("", response_model=list[ActivityRead])
def list_activity(
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ActivityRead]:
    return service.list_activity(
        db, current_user.workspace_id, entity_type=entity_type, entity_id=entity_id
    )
