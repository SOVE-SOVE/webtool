import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, model_validator


class ClientCreate(BaseModel):
    """
    Two ways to add a client: convert a won lead (reuses its business,
    marks the lead WON, and — this is the lead-to-client conversion
    workflow — also creates the delivery-side Project and its starter
    tasks in the same transaction), or add one directly for a client
    that never went through the lead pipeline (e.g. a referral, which
    gets no auto-created project).
    """

    from_lead_id: uuid.UUID | None = None
    business_name: str | None = None
    industry: str | None = None
    website_url: str | None = None
    phone: str | None = None
    suburb: str | None = None
    state: str | None = None
    billing_email: str | None = None
    assigned_user_id: uuid.UUID | None = None
    # Everything below is only meaningful with from_lead_id — the agreed
    # terms of the deal that was just won, captured on conversion. Price
    # also records a WON SalesOpportunity so it counts toward the
    # dashboard's won-projects/revenue metrics (see
    # app/modules/dashboard/service.py); package/deadline are stored
    # directly on the new Project (see app/modules/projects/models.py).
    won_price_cents: int | None = None
    package: str | None = None
    deadline: date | None = None
    # Defaults to "{business name} Website" if omitted.
    project_name: str | None = None

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "ClientCreate":
        if bool(self.from_lead_id) == bool(self.business_name):
            raise ValueError("Provide exactly one of from_lead_id or business_name")
        return self


class ClientUpdate(BaseModel):
    # Every field here is only applied when the key is present in the
    # request body at all (see model_fields_set usage in
    # service.update_client) — `null` clears/unassigns, omitting the key
    # leaves it untouched. See app/modules/leads/schemas.py's LeadUpdate
    # for the same convention.
    billing_email: str | None = None
    contract_signed_at: datetime | None = None
    assigned_user_id: uuid.UUID | None = None


class ClientRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    business_name: str
    billing_email: str | None
    contract_signed_at: datetime | None
    assigned_user_id: uuid.UUID | None
    assigned_user_name: str | None
    project_count: int
    created_at: datetime
