"""
Safe development/testing calendar provider — the calendar-sync mirror
of integrations/deployment.py's MockDeploymentProvider. Never makes a
network call and never claims a real Google (or any other) calendar
event was created: every id is obviously synthetic
(`mock-event-<uuid4>`), so a mock result can never be mistaken for a
real, externally-visible event.

Always "connected" — that's the point: it lets meeting booking,
rescheduling, and cancellation be exercised end to end (locally, in
tests, in demos) without a real Google account or OAuth round trip.
Selected via settings.calendar_provider = "mock"; see registry.py.
"""

import uuid

from sqlalchemy.orm import Session

from app.core.logging import logger
from app.integrations.calendar.base import CalendarEventInput


class MockCalendarProvider:
    name = "mock"

    def is_connected(self, db: Session, user_id: uuid.UUID) -> bool:
        return True

    def create_event(self, db: Session, user_id: uuid.UUID, event: CalendarEventInput) -> str | None:
        event_id = f"mock-event-{uuid.uuid4()}"
        logger.info("Mock calendar: created %s (%r) for user %s", event_id, event.title, user_id)
        return event_id

    def update_event(self, db: Session, user_id: uuid.UUID, event_id: str, event: CalendarEventInput) -> bool:
        logger.info("Mock calendar: updated %s -> %r", event_id, event.title)
        return True

    def delete_event(self, db: Session, user_id: uuid.UUID, event_id: str) -> bool:
        logger.info("Mock calendar: deleted %s", event_id)
        return True
