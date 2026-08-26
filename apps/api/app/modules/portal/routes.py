import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin, verify_password_or_dummy
from app.core.logging import logger
from app.core.rate_limit import clear_login_failures, login_attempt_blocked, record_login_failure
from app.core.settings import settings
from app.db.session import get_db
from app.modules.portal import service
from app.modules.portal.auth import create_portal_session_token, get_current_client_user
from app.modules.portal.models import ClientUser
from app.modules.portal.schemas import (
    ClientUserCreate,
    ClientUserCreated,
    ClientUserRead,
    ClientUserUpdate,
    PortalChangePasswordRequest,
    PortalLoginRequest,
    PortalMeResponse,
    PortalProjectRead,
)
from app.modules.users.models import User

# Client-facing — every route here depends on get_current_client_user,
# never on get_current_user (app.core.auth). See app/modules/portal/auth.py.
router = APIRouter(prefix="/api/v1/portal", tags=["portal"])

# Internal-facing — managing a client's portal accounts is itself an
# internal-user action, gated and workspace-scoped like every other
# route under /api/v1/clients.
admin_router = APIRouter(prefix="/api/v1/clients", tags=["portal-admin"])


def _to_me(client_user: ClientUser) -> PortalMeResponse:
    return PortalMeResponse(
        id=client_user.id,
        client_id=client_user.client_id,
        business_name=client_user.client.business.name,
        name=client_user.name,
        email=client_user.email,
    )


@router.post("/auth/login", response_model=PortalMeResponse)
def portal_login(
    data: PortalLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> PortalMeResponse:
    # Same limiter, keyed independently by email/IP — a flood of portal
    # login guesses doesn't share a bucket with (or get masked by) the
    # internal login endpoint's own attempts. See app.core.rate_limit.
    client_ip = request.client.host if request.client else "unknown"
    if login_attempt_blocked(data.email, client_ip):
        logger.warning("Portal login blocked by rate limit for %s from %s", data.email, client_ip)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Try again in a few minutes.",
        )

    client_user = service.get_client_user_by_email(db, data.email)
    # Runs a bcrypt check either way — see verify_password_or_dummy.
    if not verify_password_or_dummy(data.password, client_user.password_hash if client_user else None):
        record_login_failure(data.email, client_ip)
        logger.warning("Failed portal login attempt for %s from %s", data.email, client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not client_user.is_active:
        record_login_failure(data.email, client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    clear_login_failures(data.email, client_ip)
    logger.info("Client user %s logged in", client_user.id)
    service.record_login(db, client_user)

    token = create_portal_session_token(client_user.id)
    response.set_cookie(
        key=settings.portal_session_cookie_name,
        value=token,
        max_age=settings.portal_session_max_age_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
    )
    return _to_me(client_user)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def portal_logout(response: Response) -> None:
    response.delete_cookie(settings.portal_session_cookie_name)


@router.get("/auth/me", response_model=PortalMeResponse)
def portal_me(client_user: ClientUser = Depends(get_current_client_user)) -> PortalMeResponse:
    return _to_me(client_user)


@router.post("/auth/change-password", status_code=status.HTTP_204_NO_CONTENT)
def portal_change_password(
    data: PortalChangePasswordRequest,
    client_user: ClientUser = Depends(get_current_client_user),
    db: Session = Depends(get_db),
) -> None:
    service.change_password(db, client_user, data.current_password, data.new_password)


@router.get("/projects", response_model=list[PortalProjectRead])
def portal_list_projects(
    client_user: ClientUser = Depends(get_current_client_user), db: Session = Depends(get_db)
) -> list[PortalProjectRead]:
    return service.list_own_projects(db, client_user.client_id)


@router.get("/projects/{project_id}", response_model=PortalProjectRead)
def portal_get_project(
    project_id: uuid.UUID,
    client_user: ClientUser = Depends(get_current_client_user),
    db: Session = Depends(get_db),
) -> PortalProjectRead:
    project = service.get_own_project(db, client_user.client_id, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@admin_router.get("/{client_id}/portal-users", response_model=list[ClientUserRead])
def list_portal_users(
    client_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ClientUserRead]:
    portal_users = service.list_portal_users(db, current_user.workspace_id, client_id)
    if portal_users is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    return portal_users


@admin_router.post("/{client_id}/portal-users", response_model=ClientUserCreated, status_code=201)
def create_portal_user(
    client_id: uuid.UUID,
    data: ClientUserCreate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ClientUserCreated:
    """
    Admin-only, like internal user creation (users/routes.py) — issuing
    a client login credential is account-management, not routine client
    admin. Returns a server-generated temporary password once; there is
    no invite-email integration wired up yet (see docs/07_SESSION_LOG.md
    for what's left), so the admin relays it out of band.
    """
    result = service.create_portal_user(db, current_user.workspace_id, client_id, data.email, data.name)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client not found")
    client_user, temporary_password = result
    return ClientUserCreated(
        id=client_user.id,
        client_id=client_user.client_id,
        email=client_user.email,
        name=client_user.name,
        is_active=client_user.is_active,
        created_at=client_user.created_at,
        last_login_at=client_user.last_login_at,
        temporary_password=temporary_password,
    )


@admin_router.patch("/{client_id}/portal-users/{portal_user_id}", response_model=ClientUserRead)
def update_portal_user(
    client_id: uuid.UUID,
    portal_user_id: uuid.UUID,
    data: ClientUserUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ClientUserRead:
    client_user = service.set_portal_user_active(
        db, current_user.workspace_id, client_id, portal_user_id, data.is_active
    )
    if client_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portal user not found")
    return client_user
