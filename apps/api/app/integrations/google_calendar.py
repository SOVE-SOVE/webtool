"""
Google Calendar adapter — the one integration point for calendar sync,
per docs/02_ARCHITECTURE.md §6's "thin adapter, calling code decides
what to do" convention (matches integrations/search.py, integrations/
llm.py). Deliberately one-directional: this app pushes meeting events
out, it never reads the connected calendar back (no availability/
conflict checks, no webhook receiver) — see docs/05_DECISIONS.md for
why that's the "simplest appropriate" scope for this feature.

Every write call passes sendUpdates=none and never sets attendees — a
booked meeting must never trigger Google to email the lead/client an
invite. See the operator's explicit "no unnecessary emails" instruction
and docs/03_AGENT_RULES.md.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx

from app.core.logging import logger
from app.core.settings import settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"

# Least-privilege: create/edit/delete events, plus enough identity to
# show "connected as x@gmail.com" in Settings — not the full `calendar`
# scope, which would also grant calendar-settings/ACL management.
SCOPES = "https://www.googleapis.com/auth/calendar.events openid email"
REQUEST_TIMEOUT_S = 10.0


class GoogleCalendarNotConfigured(RuntimeError):
    pass


class GoogleCalendarError(RuntimeError):
    """A failed call to Google — token exchange/refresh, or the Calendar API."""


def _require_configured() -> None:
    if not settings.google_calendar_client_id or not settings.google_calendar_client_secret:
        raise GoogleCalendarNotConfigured("Google Calendar integration is not configured — see .env.example.")


def build_auth_url(state: str) -> str:
    _require_configured()
    params = {
        "client_id": settings.google_calendar_client_id,
        "redirect_uri": settings.google_calendar_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        # Forces a refresh_token on every consent (not just the first) —
        # needed so reconnect-after-disconnect always gets one again.
        "prompt": "consent",
        "state": state,
    }
    return str(httpx.URL(AUTH_URL, params=params))


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_in: int


def exchange_code(code: str) -> TokenSet:
    _require_configured()
    try:
        response = httpx.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_calendar_client_id,
                "client_secret": settings.google_calendar_client_secret,
                "redirect_uri": settings.google_calendar_redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        response.raise_for_status()
        data = response.json()
        return TokenSet(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_in=data.get("expires_in", 3600),
        )
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise GoogleCalendarError(f"Token exchange failed: {exc}") from exc


def refresh_access_token(refresh_token: str) -> str:
    _require_configured()
    try:
        response = httpx.post(
            TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": settings.google_calendar_client_id,
                "client_secret": settings.google_calendar_client_secret,
                "grant_type": "refresh_token",
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        response.raise_for_status()
        return response.json()["access_token"]
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise GoogleCalendarError(f"Token refresh failed: {exc}") from exc


def fetch_userinfo_email(access_token: str) -> str | None:
    try:
        response = httpx.get(
            USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}, timeout=REQUEST_TIMEOUT_S
        )
        response.raise_for_status()
        return response.json().get("email")
    except (httpx.HTTPError, ValueError):
        logger.warning("Couldn't fetch Google userinfo email")
        return None


def revoke_token(refresh_token: str) -> None:
    """Best-effort — disconnecting locally must succeed even if this call fails."""
    try:
        httpx.post(REVOKE_URL, params={"token": refresh_token}, timeout=REQUEST_TIMEOUT_S)
    except httpx.HTTPError:
        logger.warning("Google token revoke call failed (local disconnect proceeds anyway)")


@dataclass
class MeetingEvent:
    title: str
    description: str
    start: datetime
    duration_minutes: int


def _event_body(event: MeetingEvent) -> dict:
    end = event.start + timedelta(minutes=event.duration_minutes)
    return {
        "summary": event.title,
        "description": event.description,
        "start": {"dateTime": event.start.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
    }


def create_event(access_token: str, calendar_id: str, event: MeetingEvent) -> str | None:
    """Returns the new event id, or None on any failure — non-fatal by
    design, see modules/meetings/service.py's sync call site."""
    try:
        response = httpx.post(
            f"{CALENDAR_API_BASE}/calendars/{calendar_id}/events",
            params={"sendUpdates": "none"},
            headers={"Authorization": f"Bearer {access_token}"},
            json=_event_body(event),
            timeout=REQUEST_TIMEOUT_S,
        )
        response.raise_for_status()
        return response.json().get("id")
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Google Calendar event creation failed: %s", exc)
        return None


def update_event(access_token: str, calendar_id: str, event_id: str, event: MeetingEvent) -> bool:
    try:
        response = httpx.patch(
            f"{CALENDAR_API_BASE}/calendars/{calendar_id}/events/{event_id}",
            params={"sendUpdates": "none"},
            headers={"Authorization": f"Bearer {access_token}"},
            json=_event_body(event),
            timeout=REQUEST_TIMEOUT_S,
        )
        response.raise_for_status()
        return True
    except httpx.HTTPError as exc:
        logger.warning("Google Calendar event update failed: %s", exc)
        return False


def delete_event(access_token: str, calendar_id: str, event_id: str) -> bool:
    try:
        response = httpx.delete(
            f"{CALENDAR_API_BASE}/calendars/{calendar_id}/events/{event_id}",
            params={"sendUpdates": "none"},
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=REQUEST_TIMEOUT_S,
        )
        if response.status_code not in (200, 204, 410):  # 410 Gone = already deleted, fine
            response.raise_for_status()
        return True
    except httpx.HTTPError as exc:
        logger.warning("Google Calendar event deletion failed: %s", exc)
        return False
