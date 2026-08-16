from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.core.auth import create_session_token, require_operator, verify_password
from app.core.logging import logger
from app.core.settings import settings
from app.modules.auth.schemas import LoginRequest, MeResponse

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=MeResponse)
def login(data: LoginRequest, response: Response) -> MeResponse:
    valid_email = data.email.lower() == settings.operator_email.lower()
    valid_password = bool(settings.operator_password_hash) and verify_password(
        data.password, settings.operator_password_hash
    )
    if not (valid_email and valid_password):
        logger.warning("Failed login attempt for %s", data.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    logger.info("Operator logged in")
    token = create_session_token(settings.operator_email)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_max_age_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
    return MeResponse(email=settings.operator_email)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(settings.session_cookie_name)


@router.get("/me", response_model=MeResponse)
def me(email: str = Depends(require_operator)) -> MeResponse:
    return MeResponse(email=email)
