import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from app.modules.users.models import UserRole


class UserCreate(BaseModel):
    """Admin-created directly — no invite/signup flow, per docs/05_DECISIONS.md."""

    name: str
    email: EmailStr
    password: str
    role: UserRole = UserRole.MEMBER


class UserUpdate(BaseModel):
    role: UserRole


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    role: UserRole
    created_at: datetime
