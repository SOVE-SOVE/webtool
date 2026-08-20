import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.users.models import UserRole

# There's no self-serve password change or reset yet, so an admin-set
# password is the account's only credential for its whole life — it has
# to be a real one, not a placeholder. See docs/06_SECURITY.md.
_MIN_PASSWORD_LENGTH = 12


class UserCreate(BaseModel):
    """Admin-created directly — no invite/signup flow, per docs/05_DECISIONS.md."""

    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=_MIN_PASSWORD_LENGTH)
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
