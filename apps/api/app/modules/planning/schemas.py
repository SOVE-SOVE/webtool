import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class KeyPointRead(BaseModel):
    # Deliberately plain `str` rather than a Literal for area/severity —
    # agents/planning_audit.py's deterministic findings always use a
    # known set, but agents/planning_visual_review.py's LLM-produced
    # findings must never fail to save just because the model phrased a
    # category slightly differently than expected.
    area: str
    category: str
    severity: str
    message: str
    evidence: str
    confidence: float


class PlanningRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lead_id: uuid.UUID
    website_url: str | None
    website_audit_id: uuid.UUID | None
    status: Literal["ready_to_analyse", "analysing", "completed", "needs_review", "failed"]
    website_summary: str | None
    key_points: list[KeyPointRead]
    operator_notes: str | None
    error_message: str | None
    created_at: datetime
    analysed_at: datetime | None
    updated_at: datetime

    # Denormalized from the backing WebsiteAudit, when one exists, so the
    # frontend can render evidence/screenshots without a second request.
    has_existing_site: bool | None = None
    screenshot_desktop_base64: str | None = None
    screenshot_mobile_base64: str | None = None
    detected_technology: str | None = None


class PlanningListItem(BaseModel):
    """Lighter shape for list views (workspace-wide and per-lead) — omits
    the two base64 screenshots, which are only needed on the detail page."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    lead_id: uuid.UUID
    lead_business_name: str
    website_url: str | None
    status: Literal["ready_to_analyse", "analysing", "completed", "needs_review", "failed"]
    created_at: datetime
    analysed_at: datetime | None


class AnalysePlanningRequest(BaseModel):
    """Body for the explicit "Analyse Website" action — only meaningful
    when the workspace doesn't already have a website_url on record."""

    website_url: str | None = None


class UpdatePlanningRequest(BaseModel):
    website_summary: str | None = None
    operator_notes: str | None = None
