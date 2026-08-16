import uuid
from datetime import datetime

from pydantic import BaseModel

from app.agents.lead_score_schemas import LeadScoreOutput
from app.modules.lead_scores.models import ScoreConfidence


class LeadScoreCreate(BaseModel):
    """Empty body — scoring always runs against the lead's current business/audit data."""


class LeadScoreRead(BaseModel):
    """Built explicitly in service._to_read, not via from_attributes — see WebsiteAuditRead for why."""

    id: uuid.UUID
    lead_id: uuid.UUID
    based_on_audit_id: uuid.UUID | None
    overall_score: int
    confidence: ScoreConfidence
    config_version: int
    flagged_for_review: bool
    results: LeadScoreOutput
    scored_at: datetime
