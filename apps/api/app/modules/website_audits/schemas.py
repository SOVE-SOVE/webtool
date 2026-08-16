import uuid
from datetime import datetime

from pydantic import BaseModel

from app.agents.website_audit_schemas import WebsiteAuditOutput
from app.modules.website_audits.models import WebsiteAuditStatus


class WebsiteAuditCreate(BaseModel):
    """Empty body — the URL audited is always the lead's business.website_url."""


class WebsiteAuditRead(BaseModel):
    """
    Built explicitly in service._to_read, not via from_attributes — the
    `results` field parses the ORM row's `results_json` column into the
    structured WebsiteAuditOutput shape, which isn't a direct attribute
    match Pydantic could resolve automatically.
    """

    id: uuid.UUID
    lead_id: uuid.UUID
    url: str
    status: WebsiteAuditStatus
    has_existing_site: bool
    mobile_friendly: bool | None
    https: bool | None
    page_speed_score: int | None
    flagged_for_review: bool
    error: str | None
    report_markdown: str
    results: WebsiteAuditOutput
    audited_at: datetime
