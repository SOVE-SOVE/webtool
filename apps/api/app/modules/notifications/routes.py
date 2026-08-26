import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.notifications import service
from app.modules.notifications.schemas import (
    NotificationPreferenceRead,
    NotificationPreferenceUpdate,
    NotificationRead,
    UnreadCountRead,
)
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationRead])
def list_notifications(
    unread_only: bool = False,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[NotificationRead]:
    return service.list_notifications(db, current_user.id, unread_only=unread_only, limit=limit)


@router.get("/unread-count", response_model=UnreadCountRead)
def get_unread_count(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> UnreadCountRead:
    return UnreadCountRead(unread_count=service.unread_count(db, current_user.id))


@router.post("/{notification_id}/read", response_model=NotificationRead)
def mark_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationRead:
    notification = service.mark_read(db, current_user.id, notification_id)
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    return notification


@router.post("/read-all")
def mark_all_read(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    count = service.mark_all_read(db, current_user.id)
    return {"marked_read": count}


@router.get("/preferences", response_model=list[NotificationPreferenceRead])
def get_preferences(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[NotificationPreferenceRead]:
    return service.get_preferences(db, current_user.id)


@router.put("/preferences", response_model=list[NotificationPreferenceRead])
def update_preferences(
    data: NotificationPreferenceUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[NotificationPreferenceRead]:
    updates = [(item.type, item.enabled) for item in data.preferences]
    return service.update_preferences(db, current_user.id, updates)
