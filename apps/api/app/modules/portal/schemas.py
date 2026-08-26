import uuid
from datetime import date, datetime

from pydantic import BaseModel, EmailStr

from app.modules.projects.models import ProjectStage


# --- client-facing (portal) ---


class PortalLoginRequest(BaseModel):
    email: EmailStr
    password: str


class PortalChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class PortalMeResponse(BaseModel):
    id: uuid.UUID
    client_id: uuid.UUID
    business_name: str
    name: str
    email: str


# Deliberately not the internal ProjectRead (apps/web ProjectUpdate etc.)
# — no price_cents, assigned_user_id/name, or source_lead_id. Those are
# the business's own commercial/staffing details, not something a
# client account should ever be able to read. See docs/06_SECURITY.md.
class PortalProjectRead(BaseModel):
    id: uuid.UUID
    name: str
    stage: ProjectStage
    stage_label: str
    package: str | None
    deadline: date | None
    created_at: datetime
    updated_at: datetime


# --- internal-facing (managing a client's portal accounts) ---


class ClientUserCreate(BaseModel):
    email: EmailStr
    name: str


class ClientUserRead(BaseModel):
    id: uuid.UUID
    client_id: uuid.UUID
    email: str
    name: str
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


# Returned once, only from the create endpoint — the one time the
# plaintext temporary password exists outside the hash. Never returned
# from any other route, never logged.
class ClientUserCreated(ClientUserRead):
    temporary_password: str


class ClientUserUpdate(BaseModel):
    is_active: bool
