import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Severity = Literal["low", "medium", "high", "critical"]


class QualityFinding(BaseModel):
    """One structured finding — every field required so a finding can
    never be presented without saying what it's based on and how sure
    the audit is. See app/agents/website_quality.py (added in the
    quality-analysis capability, not yet built here)."""

    category: str
    severity: Severity
    message: str
    evidence: str
    confidence: float


class WebsiteQualityAuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    discovered_business_id: uuid.UUID
    business_research_id: uuid.UUID | None
    findings: list[QualityFinding]
    summary: str | None
    issue_count: int
    critical_count: int
    audited_at: datetime
