import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_admin
from app.db.session import get_db
from app.modules.users import service
from app.modules.users.models import User
from app.modules.users.schemas import UserCreate, UserRead, UserUpdate

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get("", response_model=list[UserRead])
def list_users(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[UserRead]:
    """Any workspace member can see the member list — assignment needs it."""
    return service.list_users(db, current_user.workspace_id)


@router.post("", response_model=UserRead, status_code=201)
def create_user(
    data: UserCreate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserRead:
    """Admin-only, per docs/01_REQUIREMENTS.md's ADMIN role: manage users."""
    return service.create_user(db, current_user.workspace_id, data)


@router.patch("/{user_id}", response_model=UserRead)
def update_user_role(
    user_id: uuid.UUID,
    data: UserUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserRead:
    user = service.update_user_role(db, current_user.workspace_id, user_id, data)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
