import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.modules.discovery.models import OpportunityScoreCategory

Direction = Literal["positive", "negative"]


class ScoreFactor(BaseModel):
    """One line item in the score breakdown — every point on the score
    traces back to one of these. See app/agents/opportunity_score.py
    (added in the scoring capability, not yet built here)."""

    factor: str
    points: int
    direction: Direction
    explanation: str


def _split(text: str | None) -> list[str]:
    if not text:
        return []
    return [line.strip() for line in text.splitlines() if line.strip()]


class OpportunityScoreResultRead(BaseModel):
    id: uuid.UUID
    discovered_business_id: uuid.UUID
    overall_score: int
    category: OpportunityScoreCategory
    confidence: float
    positive_signals: list[str]
    negative_signals: list[str]
    factors: list[ScoreFactor]
    recommendation_reason: str
    scored_at: datetime

    @classmethod
    def from_model(cls, result) -> "OpportunityScoreResultRead":
        return cls(
            id=result.id,
            discovered_business_id=result.discovered_business_id,
            overall_score=result.overall_score,
            category=result.category,
            confidence=result.confidence,
            positive_signals=_split(result.positive_signals),
            negative_signals=_split(result.negative_signals),
            factors=[ScoreFactor.model_validate(f) for f in result.factors],
            recommendation_reason=result.recommendation_reason,
            scored_at=result.scored_at,
        )
