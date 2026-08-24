import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.sales_opportunities.models import OpportunityStatus


class SalesOpportunityCreate(BaseModel):
    """Logs a real proposal/quote against a lead — the dollar figure the
    sales command centre's estimated-revenue metric is built from. Never
    inferred or guessed; if the operator hasn't logged one yet, the lead
    simply has no opportunity row and contributes nothing to the total."""

    tier: str | None = None
    proposed_price_cents: int | None = None


class SalesOpportunityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lead_id: uuid.UUID
    business_name: str
    tier: str | None
    proposed_price_cents: int | None
    status: OpportunityStatus
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
