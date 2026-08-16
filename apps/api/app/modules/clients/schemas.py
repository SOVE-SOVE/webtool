import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator


class ClientCreate(BaseModel):
    """
    Two ways to add a client: convert a won lead (reuses its business,
    and marks the lead WON), or add one directly for a client that never
    went through the lead pipeline (e.g. a referral).
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
    # Only meaningful with from_lead_id — records the deal as won at this
    # price, so it counts toward the dashboard's won-projects/revenue
    # metrics (see app/modules/dashboard/service.py).
    won_price_cents: int | None = None

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "ClientCreate":
        if bool(self.from_lead_id) == bool(self.business_name):
            raise ValueError("Provide exactly one of from_lead_id or business_name")
        return self


class ClientUpdate(BaseModel):
    # See app/modules/leads/schemas.py's LeadUpdate for why this stays a
    # plain optional field: the key must be present at all to change
    # assignment, `null` unassigns.
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
