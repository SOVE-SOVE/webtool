"""
Wraps integrations/google_calendar.py (the raw OAuth + Calendar API
HTTP client, unchanged) and modules/calendar/connections.py (per-user
token storage/refresh, unchanged) behind the CalendarProvider
interface. This is the only file that imports both — after this
change, modules/meetings/service.py no longer imports either directly,
only app.integrations.calendar.registry.
"""

import uuid

from sqlalchemy.orm import Session

from app.integrations import google_calendar
from app.integrations.calendar.base import CalendarEventInput


class GoogleCalendarProvider:
    name = "google"

    def is_connected(self, db: Session, user_id: uuid.UUID) -> bool:
        # Imported here, not at module scope, to avoid a circular import
        # with modules/calendar/service.py — see connections.py's own
        # docstring for the same reasoning this mirrors.
        from app.modules.calendar import connections

        return connections.get_valid_access_token(db, user_id) is not None

    def create_event(self, db: Session, user_id: uuid.UUID, event: CalendarEventInput) -> str | None:
        from app.modules.calendar import connections

        access_token = connections.get_valid_access_token(db, user_id)
        if access_token is None:
            return None
        calendar_id = connections.get_connection_calendar_id(db, user_id)
        return google_calendar.create_event(access_token, calendar_id, self._to_meeting_event(event))

    def update_event(self, db: Session, user_id: uuid.UUID, event_id: str, event: CalendarEventInput) -> bool:
        from app.modules.calendar import connections

        access_token = connections.get_valid_access_token(db, user_id)
        if access_token is None:
            return False
        calendar_id = connections.get_connection_calendar_id(db, user_id)
        return google_calendar.update_event(access_token, calendar_id, event_id, self._to_meeting_event(event))

    def delete_event(self, db: Session, user_id: uuid.UUID, event_id: str) -> bool:
        from app.modules.calendar import connections

        access_token = connections.get_valid_access_token(db, user_id)
        if access_token is None:
            return False
        calendar_id = connections.get_connection_calendar_id(db, user_id)
        return google_calendar.delete_event(access_token, calendar_id, event_id)

    @staticmethod
    def _to_meeting_event(event: CalendarEventInput) -> google_calendar.MeetingEvent:
        # attendee_emails is deliberately dropped here — google_calendar.py's
        # _event_body() never sets attendees, and this adapter must not
        # reintroduce that path. See base.py's CalendarEventInput docstring.
        return google_calendar.MeetingEvent(
            title=event.title,
            description=event.description,
            start=event.start,
            duration_minutes=event.duration_minutes,
        )
