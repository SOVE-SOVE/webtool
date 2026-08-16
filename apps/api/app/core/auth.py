import uuid
from typing import TYPE_CHECKING

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from app.core.settings import settings
from app.db.session import get_db

if TYPE_CHECKING:
    from app.modules.users.models import User


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt="wdos-session")


def create_session_token(user_id: uuid.UUID) -> str:
    return _serializer().dumps({"user_id": str(user_id)})


def verify_session_token(token: str) -> uuid.UUID | None:
    try:
        data = _serializer().loads(token, max_age=settings.session_max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None
    raw_id = data.get("user_id")
    if raw_id is None:
        return None
    try:
        return uuid.UUID(raw_id)
    except ValueError:
        return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> "User":
    """
    FastAPI dependency guarding every route that isn't public. The
    session cookie carries a user id (not a fixed email — see
    docs/02_ARCHITECTURE.md §7), so every route depending on this gets
    a real `User` row it can use to scope queries to
    `user.workspace_id` and check `user.role`.
    """
    # Imported here, not at module scope, to avoid a circular import:
    # app.modules.users.service imports hash_password from this module.
    from app.modules.users.models import User

    token = request.cookies.get(settings.session_cookie_name)
    user_id = verify_session_token(token) if token else None
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


def require_admin(current_user: "User" = Depends(get_current_user)) -> "User":
    """
    Admin-only routes per docs/01_REQUIREMENTS.md's ADMIN role: manage
    users, workspace settings, integrations.
    """
    from app.modules.users.models import UserRole

    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return current_user
