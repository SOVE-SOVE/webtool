"""
The provider adapter contract for calendar sync —
`modules/meetings/service.py` codes only against this interface, never
against a concrete provider, per the same "design around provider
adapters so an external integration can be swapped later; do not
hard-code a single provider into the business logic" convention as
`app/integrations/discovery/base.py`.

This supersedes the 2026-08-18 calendar decision in
docs/05_DECISIONS.md that rejected a multi-provider abstraction ("one
provider, one adapter, until a second is actually needed") — a second
is now needed: `MockCalendarProvider`, so meeting booking/rescheduling/
cancellation can be exercised in development and tests without a real
Google account or OAuth round trip. See registry.py for how a future
real second provider (Outlook, CalDAV) would plug in without a
service-layer change.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from sqlalchemy.orm import Session


@dataclass
class CalendarEventInput:
    """
    What every provider's create/update_event receives — assembled once
    in modules/meetings/service.py from a Meeting, so no provider branches
    on the caller's internal model shape.
    """

    title: str
    description: str
    start: datetime
    duration_minutes: int
    # Informational only. No provider implementation in this app may use
    # this to send a real invite email — see integrations/google_calendar.py's
    # module docstring for why ("no unnecessary emails" is a hard rule,
    # not a default that a provider is free to override).
    attendee_emails: list[str] = field(default_factory=list)


class CalendarProvider(Protocol):
    name: str

    def is_connected(self, db: Session, user_id: uuid.UUID) -> bool:
        """Whether this user has a usable calendar connection right now."""
        ...

    def create_event(self, db: Session, user_id: uuid.UUID, event: CalendarEventInput) -> str | None:
        """
        Returns the new external event id, or None on any failure.
        Best-effort and non-fatal by design, matching the existing
        contract (see modules/meetings/service.py's sync call site): a
        meeting is booked in this app regardless of whether the
        calendar push succeeds.
        """
        ...

    def update_event(self, db: Session, user_id: uuid.UUID, event_id: str, event: CalendarEventInput) -> bool:
        """Returns whether the update succeeded. Same best-effort contract as create_event."""
        ...

    def delete_event(self, db: Session, user_id: uuid.UUID, event_id: str) -> bool:
        """Returns whether the deletion succeeded (or the event was already gone)."""
        ...
