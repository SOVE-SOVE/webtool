import bcrypt
from fastapi import HTTPException, Request, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.settings import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt="wdos-session")


def create_session_token(email: str) -> str:
    return _serializer().dumps({"email": email})


def verify_session_token(token: str) -> str | None:
    try:
        data = _serializer().loads(token, max_age=settings.session_max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None
    return data.get("email")


def require_operator(request: Request) -> str:
    """
    FastAPI dependency guarding every route that isn't public. There is
    exactly one operator account — see docs/03_AGENT_RULES.md — so this
    checks a single signed session cookie, not a user table.
    """
    token = request.cookies.get(settings.session_cookie_name)
    email = verify_session_token(token) if token else None
    if email is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return email
