from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.settings import settings
from app.db.session import get_db
from app.integrations import google_calendar
from app.modules.calendar import connections, service
from app.modules.calendar.schemas import CalendarConnectionRead, CalendarEvent
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/calendar", tags=["calendar"])


def _web_app_base_url() -> str:
    origins = settings.allowed_origins_list
    return origins[0] if origins else "http://localhost:3000"


@router.get("", response_model=list[CalendarEvent])
def list_calendar_events(
    start: date,
    end: date,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CalendarEvent]:
    return service.list_events(db, current_user.workspace_id, start, end)


@router.get("/google/status", response_model=CalendarConnectionRead | None)
def google_calendar_status(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> CalendarConnectionRead | None:
    return connections.get_connection(db, current_user.id)


@router.get("/google/connect")
def connect_google_calendar(current_user: User = Depends(get_current_user)) -> RedirectResponse:
    """
    Kicks off the OAuth round trip — this is a real browser navigation
    (not a fetch() call), so the frontend points a link/button straight
    at this URL rather than calling it via the api client.
    """
    try:
        url = connections.build_connect_url(current_user.id)
    except google_calendar.GoogleCalendarNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return RedirectResponse(url)


@router.get("/google/callback")
def google_calendar_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """
    Google redirects the browser here after consent. The browser still
    carries our own session cookie on this hop (it's a top-level
    navigation back to our own origin), so this is auth'd the same as
    any other route — the signed `state` param is still required and
    checked (standard OAuth CSRF defense) and must match the
    already-authenticated user, not just be validly signed by anyone.
    """
    base = _web_app_base_url()
    state_user_id = connections.verify_state(state) if state else None

    if error or not code or state_user_id != current_user.id:
        return RedirectResponse(f"{base}/dashboard/settings?calendar=error")

    try:
        connections.complete_connection(db, current_user.id, code)
    except (google_calendar.GoogleCalendarError, google_calendar.GoogleCalendarNotConfigured):
        return RedirectResponse(f"{base}/dashboard/settings?calendar=error")

    return RedirectResponse(f"{base}/dashboard/settings?calendar=connected")


@router.post("/google/disconnect", status_code=204)
def disconnect_google_calendar(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    connections.disconnect(db, current_user.id)
