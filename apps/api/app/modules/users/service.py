import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import hash_password
from app.modules.users.models import User
from app.modules.users.schemas import UserCreate, UserUpdate


def list_users(db: Session, workspace_id: uuid.UUID) -> list[User]:
    return list(
        db.scalars(select(User).where(User.workspace_id == workspace_id).order_by(User.created_at))
    )


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.lower()))


def require_user_in_workspace(db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """
    Guards every assignment (lead/client/project/task) against pointing
    at a user outside the acting user's workspace — otherwise
    assignment would be an unintended cross-workspace data leak.
    """
    exists = (
        db.scalar(select(User.id).where(User.id == user_id, User.workspace_id == workspace_id))
        is not None
    )
    if not exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned user not found")


def create_user(db: Session, workspace_id: uuid.UUID, data: UserCreate) -> User:
    if get_by_email(db, data.email) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    user = User(
        workspace_id=workspace_id,
        name=data.name,
        email=data.email.lower(),
        role=data.role,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user_role(
    db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID, data: UserUpdate
) -> User | None:
    user = db.scalar(select(User).where(User.id == user_id, User.workspace_id == workspace_id))
    if user is None:
        return None
    user.role = data.role
    db.commit()
    db.refresh(user)
    return user
