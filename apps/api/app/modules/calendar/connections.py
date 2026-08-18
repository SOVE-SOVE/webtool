"""
Google Calendar connection (OAuth) management — per user, see
modules/calendar/models.py's CalendarConnection. Only the refresh token
is persisted (encrypted, see app/core/crypto.py), never an access token.

Deliberately a separate file from modules/calendar/service.py (the
read-only meetings+tasks aggregation): that module imports
modules/meetings/service.py, and modules/meetings/service.py needs
get_valid_access_token from here to sync a booked meeting — importing
this file from meetings/service.py instead avoids a circular import.
"""

import uuid

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.logging import logger
from app.core.settings import settings
from app.integrations import google_calendar
from app.modules.calendar.models import CalendarConnection
from app.modules.calendar.schemas import CalendarConnectionRead

# CSRF state for the OAuth round trip — short-lived (the user completes
# Google's consent screen in under a couple of minutes normally), signed
# with the same session secret used for session cookies but a distinct
# salt so a leaked session token can't be replayed as OAuth state or
# vice versa.
_STATE_MAX_AGE_SECONDS = 600


def _state_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt="wdos-google-oauth-state")


def get_connection(db: Session, user_id: uuid.UUID) -> CalendarConnectionRead | None:
    connection = db.scalar(select(CalendarConnection).where(CalendarConnection.user_id == user_id))
    return CalendarConnectionRead.model_validate(connection) if connection else None


def build_connect_url(user_id: uuid.UUID) -> str:
    state = _state_serializer().dumps({"user_id": str(user_id)})
    return google_calendar.build_auth_url(state)


def verify_state(state: str) -> uuid.UUID | None:
    try:
        data = _state_serializer().loads(state, max_age=_STATE_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    raw_id = data.get("user_id")
    if raw_id is None:
        return None
    try:
        return uuid.UUID(raw_id)
    except ValueError:
        return None


def complete_connection(db: Session, user_id: uuid.UUID, code: str) -> CalendarConnectionRead:
    tokens = google_calendar.exchange_code(code)
    if tokens.refresh_token is None:
        # Shouldn't happen with prompt=consent, but a stale/duplicate
        # callback (e.g. the user double-clicked, or refreshed the
        # redirect) can hit this — surface it as the same "try again"
        # error path the route already has for GoogleCalendarError.
        raise google_calendar.GoogleCalendarError("Google did not return a refresh token")

    email = google_calendar.fetch_userinfo_email(tokens.access_token)
    encrypted = crypto.encrypt_secret(tokens.refresh_token)

    connection = db.scalar(select(CalendarConnection).where(CalendarConnection.user_id == user_id))
    if connection is None:
        connection = CalendarConnection(user_id=user_id, encrypted_refresh_token=encrypted, google_email=email)
        db.add(connection)
    else:
        connection.encrypted_refresh_token = encrypted
        connection.google_email = email

    db.commit()
    db.refresh(connection)
    return CalendarConnectionRead.model_validate(connection)


def disconnect(db: Session, user_id: uuid.UUID) -> bool:
    connection = db.scalar(select(CalendarConnection).where(CalendarConnection.user_id == user_id))
    if connection is None:
        return False

    refresh_token = crypto.decrypt_secret(connection.encrypted_refresh_token)
    if refresh_token:
        google_calendar.revoke_token(refresh_token)

    db.delete(connection)
    db.commit()
    return True


def get_valid_access_token(db: Session, user_id: uuid.UUID) -> str | None:
    """
    Used by modules/meetings/service.py to sync one event. Returns None
    (never raises) if the user has no connection, the stored token
    can't be decrypted (key rotated), or Google's refresh call fails
    (e.g. the user revoked access from their Google account directly) —
    calendar sync is always best-effort, never something that should
    fail a meeting-booking request. See docs/05_DECISIONS.md.
    """
    connection = db.scalar(select(CalendarConnection).where(CalendarConnection.user_id == user_id))
    if connection is None:
        return None

    refresh_token = crypto.decrypt_secret(connection.encrypted_refresh_token)
    if refresh_token is None:
        return None

    try:
        return google_calendar.refresh_access_token(refresh_token)
    except google_calendar.GoogleCalendarError as exc:
        logger.warning("Google Calendar token refresh failed for user %s: %s", user_id, exc)
        return None


def get_connection_calendar_id(db: Session, user_id: uuid.UUID) -> str:
    connection = db.scalar(select(CalendarConnection).where(CalendarConnection.user_id == user_id))
    return connection.calendar_id if connection else "primary"
