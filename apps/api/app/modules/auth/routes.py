from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.auth import create_session_token, get_current_user, verify_password_or_dummy
from app.core.logging import logger
from app.core.rate_limit import (
    clear_login_failures,
    login_attempt_blocked,
    record_login_failure,
)
from app.core.settings import settings
from app.db.session import get_db
from app.modules.auth.schemas import LoginRequest, MeResponse
from app.modules.users.models import User
from app.modules.users.service import get_by_email

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _to_me(user: User) -> MeResponse:
    return MeResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        workspace_id=user.workspace_id,
        workspace_name=user.workspace.name,
    )


@router.post("/login", response_model=MeResponse)
def login(
    data: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> MeResponse:
    client_ip = request.client.host if request.client else "unknown"
    if login_attempt_blocked(data.email, client_ip):
        logger.warning("Login blocked by rate limit for %s from %s", data.email, client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Try again in a few minutes.",
        )

    user = get_by_email(db, data.email)
    # Runs a bcrypt check either way — see verify_password_or_dummy.
    if not verify_password_or_dummy(data.password, user.password_hash if user else None):
        record_login_failure(data.email, client_ip)
        logger.warning("Failed login attempt for %s from %s", data.email, client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    clear_login_failures(data.email, client_ip)
    logger.info("User %s logged in", user.id)
    token = create_session_token(user.id)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_max_age_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
    return _to_me(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(settings.session_cookie_name)


@router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user)) -> MeResponse:
    return _to_me(current_user)
