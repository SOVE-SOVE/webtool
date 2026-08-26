import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.notifications.models import NotificationType


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: NotificationType
    title: str
    body: str
    href: str | None
    entity_type: str | None
    entity_id: uuid.UUID | None
    read_at: datetime | None
    created_at: datetime


class UnreadCountRead(BaseModel):
    unread_count: int


class NotificationPreferenceRead(BaseModel):
    type: NotificationType
    enabled: bool


class NotificationPreferenceUpdateItem(BaseModel):
    type: NotificationType
    enabled: bool


class NotificationPreferenceUpdate(BaseModel):
    preferences: list[NotificationPreferenceUpdateItem]
