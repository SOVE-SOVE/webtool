"""
Structured output for the lead-scoring engine (app/agents/lead_score.py).

The scoring *policy* — category weights, target industries/regions, and
the point-scoring rules themselves — lives in app/agents/scoring_rules.json,
not here or in lead_score.py, so it can be edited without touching code.
See docs/05_DECISIONS.md.
"""

import enum

from pydantic import BaseModel, Field

from app.agents.website_audit_schemas import WebsiteAuditOutput

CATEGORY_KEYS = (
    "website_opportunity",
    "business_fit",
    "commercial_value",
    "local_relevance",
    "contactability",
    "growth_opportunity",
)

CATEGORY_LABELS = {
    "website_opportunity": "Website improvement opportunity",
    "business_fit": "Business/service fit",
    "commercial_value": "Potential commercial value",
    "local_relevance": "Local relevance",
    "contactability": "Contactability",
    "growth_opportunity": "Visible growth opportunity",
}


class Confidence(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


# Ordered weakest-to-strongest so "the weakest category confidence" can be
# computed with min() over this ordering.
_CONFIDENCE_ORDER = {Confidence.LOW: 0, Confidence.MEDIUM: 1, Confidence.HIGH: 2}


def weakest_confidence(confidences: list[Confidence]) -> Confidence:
    return min(confidences, key=lambda c: _CONFIDENCE_ORDER[c])


class ScoreReason(BaseModel):
    """One matched rule — the atomic unit of "explainable" here. Every
    point on the board traces back to exactly one of these."""

    rule_id: str
    description: str
    points: int


class CategoryScore(BaseModel):
    key: str
    label: str
    score: int  # 0-100, before weighting
    weight: int  # this category's share of the overall /100 score
    confidence: Confidence
    reasons: list[ScoreReason] = Field(default_factory=list)


class LeadScoreOutput(BaseModel):
    overall_score: int  # 0-100
    confidence: Confidence
    categories: list[CategoryScore]
    warnings: list[str] = Field(default_factory=list)
    config_version: int


class LeadScoreInput(BaseModel):
    """
    Everything the scoring engine is allowed to see — deliberately just
    business-level facts. If a field isn't listed here, the engine
    cannot use it, which is the actual enforcement mechanism behind "no
    sensitive personal characteristics," not just a stated policy.
    """

    industry: str | None = None
    suburb: str | None = None
    state: str | None = None
    phone: str | None = None
    email: str | None = None
    social_links: str | None = None
    abn: str | None = None
    website_url: str | None = None
    audit: WebsiteAuditOutput | None = None
    audit_flagged_for_review: bool = False
