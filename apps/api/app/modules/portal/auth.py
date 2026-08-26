import uuid

from fastapi import Depends, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from app.core.settings import settings
from app.db.session import get_db
from app.modules.portal.models import ClientUser

# Same SESSION_SECRET as the internal session (app/core/auth.py), but a
# distinct salt — itsdangerous mixes the salt into the signature, so a
# token minted here fails signature verification under the internal
# serializer's salt and vice versa. This is the same technique already
# used to isolate the Google Calendar OAuth `state` param (see
# app/modules/calendar) from the session cookie. Combined with a cookie
# name that's never checked by app.core.auth.get_current_user, and a
# distinct model (ClientUser, not User), there is no path from a portal
# login to an internal session or from an internal login to a portal
# session.
_PORTAL_SALT = "wdos-portal-session"


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt=_PORTAL_SALT)


def create_portal_session_token(client_user_id: uuid.UUID) -> str:
    return _serializer().dumps({"client_user_id": str(client_user_id)})


def verify_portal_session_token(token: str) -> uuid.UUID | None:
    try:
        data = _serializer().loads(token, max_age=settings.portal_session_max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None
    raw_id = data.get("client_user_id")
    if raw_id is None:
        return None
    try:
        return uuid.UUID(raw_id)
    except ValueError:
        return None


def get_current_client_user(request: Request, db: Session = Depends(get_db)) -> ClientUser:
    """
    The portal counterpart to app.core.auth.get_current_user. Every
    portal-facing route depends on this, never on get_current_user —
    the two are not interchangeable by construction (different cookie
    name, different signing salt, different table).
    """
    token = request.cookies.get(settings.portal_session_cookie_name)
    client_user_id = verify_portal_session_token(token) if token else None
    if client_user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    client_user = db.get(ClientUser, client_user_id)
    if client_user is None or not client_user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return client_user
