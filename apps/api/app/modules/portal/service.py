import secrets
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.auth import hash_password
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.portal.models import ClientUser
from app.modules.portal.schemas import PortalProjectRead
from app.modules.projects.models import Project, ProjectStage

_STAGE_LABELS: dict[ProjectStage, str] = {
    ProjectStage.INTAKE: "Intake",
    ProjectStage.RESEARCH: "Research",
    ProjectStage.BRIEF: "Brief",
    ProjectStage.DESIGN: "Design",
    ProjectStage.DEVELOPMENT: "Development",
    ProjectStage.QA: "Quality assurance",
    ProjectStage.CLIENT_REVIEW: "Your review",
    ProjectStage.REVISIONS: "Revisions",
    ProjectStage.READY_TO_DEPLOY: "Ready to launch",
    ProjectStage.DEPLOYED: "Launched",
    ProjectStage.MAINTENANCE: "Maintenance",
    ProjectStage.COMPLETE: "Complete",
}


def _to_project_read(project: Project) -> PortalProjectRead:
    return PortalProjectRead(
        id=project.id,
        name=project.name,
        stage=project.stage,
        stage_label=_STAGE_LABELS[project.stage],
        package=project.package,
        deadline=project.deadline,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


# --- client-facing: auth ---


def get_client_user_by_email(db: Session, email: str) -> ClientUser | None:
    return db.scalar(
        select(ClientUser).where(ClientUser.email == email.lower()).options(joinedload(ClientUser.client))
    )


def record_login(db: Session, client_user: ClientUser) -> None:
    client_user.last_login_at = datetime.now(timezone.utc)
    db.commit()


def change_password(db: Session, client_user: ClientUser, current_password: str, new_password: str) -> None:
    from app.core.auth import verify_password

    if not verify_password(current_password, client_user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    if len(new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 8 characters"
        )
    client_user.password_hash = hash_password(new_password)
    db.commit()


# --- client-facing: own project status ---


def list_own_projects(db: Session, client_id: uuid.UUID) -> list[PortalProjectRead]:
    projects = db.scalars(
        select(Project).where(Project.client_id == client_id).order_by(Project.created_at.desc())
    )
    return [_to_project_read(p) for p in projects]


def get_own_project(db: Session, client_id: uuid.UUID, project_id: uuid.UUID) -> PortalProjectRead | None:
    project = db.scalar(select(Project).where(Project.id == project_id, Project.client_id == client_id))
    return _to_project_read(project) if project else None


# --- internal-facing: managing a client's portal accounts ---


def _load_client_in_workspace(db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID) -> Client | None:
    return db.scalar(
        select(Client)
        .join(Business, Client.business_id == Business.id)
        .where(Client.id == client_id, Business.workspace_id == workspace_id)
    )


def list_portal_users(
    db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID
) -> list[ClientUser] | None:
    if _load_client_in_workspace(db, workspace_id, client_id) is None:
        return None
    return list(
        db.scalars(
            select(ClientUser).where(ClientUser.client_id == client_id).order_by(ClientUser.created_at)
        )
    )


def create_portal_user(
    db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID, email: str, name: str
) -> tuple[ClientUser, str] | None:
    """
    Returns (client_user, temporary_password) — the caller (route) hands
    the plaintext password back to the admin exactly once, to relay to
    the client out of band. It is never stored or logged anywhere.
    """
    if _load_client_in_workspace(db, workspace_id, client_id) is None:
        return None

    normalized_email = email.lower()
    if db.scalar(select(ClientUser.id).where(ClientUser.email == normalized_email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    temporary_password = secrets.token_urlsafe(12)
    client_user = ClientUser(
        client_id=client_id,
        email=normalized_email,
        name=name,
        password_hash=hash_password(temporary_password),
    )
    db.add(client_user)
    db.commit()
    db.refresh(client_user)
    return client_user, temporary_password


def set_portal_user_active(
    db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID, portal_user_id: uuid.UUID, is_active: bool
) -> ClientUser | None:
    if _load_client_in_workspace(db, workspace_id, client_id) is None:
        return None
    client_user = db.scalar(
        select(ClientUser).where(ClientUser.id == portal_user_id, ClientUser.client_id == client_id)
    )
    if client_user is None:
        return None
    client_user.is_active = is_active
    db.commit()
    db.refresh(client_user)
    return client_user
