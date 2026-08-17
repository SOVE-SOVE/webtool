from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.calendar import service
from app.modules.calendar.schemas import CalendarEvent
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/calendar", tags=["calendar"])


@router.get("", response_model=list[CalendarEvent])
def list_calendar_events(
    start: date,
    end: date,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CalendarEvent]:
    return service.list_events(db, current_user.workspace_id, start, end)
