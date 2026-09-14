import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, model_validator

from app.modules.projects.models import ProjectStage


class ProjectCreate(BaseModel):
    """
    Exactly one of `client_id`/`lead_id` — a Client-owned project (today's
    original path) or a Lead-owned prospect project (speculative work
    before the operator explicitly converts the lead — see
    docs/05_DECISIONS.md). Mirrors `clients/schemas.py::ClientCreate`'s
    own `_exactly_one_source` validator.
    """

    client_id: uuid.UUID | None = None
    lead_id: uuid.UUID | None = None
    name: str
    assigned_user_id: uuid.UUID | None = None
    # The agreed terms of this project's engagement — optional here since
    # a manually-added project (not from a lead conversion) may not have
    # them yet. See app/modules/clients/schemas.py's ClientCreate for the
    # conversion path, which sets these directly.
    package: str | None = None
    price_cents: int | None = None
    deadline: date | None = None

    @model_validator(mode="after")
    def _exactly_one_owner(self) -> "ProjectCreate":
        if bool(self.client_id) == bool(self.lead_id):
            raise ValueError("Provide exactly one of client_id or lead_id")
        return self


class ProjectUpdate(BaseModel):
    stage: ProjectStage | None = None
    # See leads/schemas.py's LeadUpdate for why this stays a plain
    # optional field: the key must be present at all to change
    # assignment, `null` unassigns.
    assigned_user_id: uuid.UUID | None = None
    package: str | None = None
    price_cents: int | None = None
    deadline: date | None = None
    build_direction: str | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID | None
    business_id: uuid.UUID
    # The name of whichever business currently owns this project (its
    # Client's business, or — for a prospect project with no Client yet
    # — its owning Lead's business). Kept non-nullable and under its
    # original name for backward compatibility; every project always
    # has exactly one live owner business at read time.
    client_business_name: str
    source_lead_id: uuid.UUID | None
    name: str
    stage: ProjectStage
    package: str | None
    price_cents: int | None
    deadline: date | None
    build_direction: str | None
    assigned_user_id: uuid.UUID | None
    assigned_user_name: str | None
    delivered_at: datetime | None
    delivered_by_user_name: str | None
    created_at: datetime
    updated_at: datetime


class DeliveryChecklistItemRead(BaseModel):
    task_id: uuid.UUID
    title: str
    done: bool


class DeliveryStatusRead(BaseModel):
    """What's still blocking `POST /projects/{id}/deliver` — the same
    "show every missing thing at once" shape as
    modules/approvals/service.py's ProjectApprovalStatus."""

    can_deliver: bool
    already_delivered: bool
    has_successful_deployment: bool
    deployment_verified: bool
    latest_deployment_url: str | None
    checklist: list[DeliveryChecklistItemRead]
    missing: list[str]
