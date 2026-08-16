import uuid

from pydantic import BaseModel, EmailStr

from app.modules.users.models import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class MeResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: UserRole
    workspace_id: uuid.UUID
    workspace_name: str
