import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class CalendarConnectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    google_email: str | None
    calendar_id: str
    connected_at: datetime


class CalendarEvent(BaseModel):
    """
    One row on the calendar — a meeting or a task due date. Read-only
    view assembled from Meeting/Task; there's no calendar_events table.
    `href` points at the entity's edit surface (meetings live on the
    calendar page itself; tasks live on /dashboard/tasks).
    """

    kind: Literal["meeting", "task"]
    id: uuid.UUID
    title: str
    at: datetime
    detail: str
    done: bool | None
    href: str
