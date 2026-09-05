import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.modules.review_intelligence.models import ReviewActivityLevel, ReviewDataStatus, ReviewSentimentTrend, ReviewVolumeTrend

FactorDirection = Literal["positive", "negative", "neutral"]


class ReviewHealthFactor(BaseModel):
    """One line item in the health score breakdown — every point traces
    back to one of these. See app/agents/review_intelligence.py."""

    factor: str
    points: float
    direction: FactorDirection
    explanation: str


class ReviewTheme(BaseModel):
    theme: str
    occurrences: int
    confidence: float
    evidence: list[str] = []


class ReviewEvidenceItem(BaseModel):
    rating: int | None
    snippet: str
    published_at: datetime | None
    relative_time_description: str | None


class ReviewIntelligenceResultRead(BaseModel):
    id: uuid.UUID
    discovered_business_id: uuid.UUID

    data_status: ReviewDataStatus
    review_data_source: str

    google_rating: float | None
    google_review_count: int | None
    reviews_sampled: int
    reviews_with_text: int

    review_activity_level: ReviewActivityLevel
    review_frequency_per_month: float | None
    recent_review_count: int | None
    previous_review_count: int | None
    last_review_at: datetime | None
    review_volume_trend: ReviewVolumeTrend
    review_sentiment_trend: ReviewSentimentTrend

    rating_distribution: dict[str, float] | None

    review_health_score: int | None
    review_health_factors: list[ReviewHealthFactor]

    themes_data_sufficient: bool
    positive_review_themes: list[ReviewTheme]
    negative_review_themes: list[ReviewTheme]

    review_summary: str | None
    review_summary_unavailable_reason: str | None
    review_evidence: list[ReviewEvidenceItem]

    data_limitations: str | None
    review_data_updated_at: datetime

    @classmethod
    def from_model(cls, result) -> "ReviewIntelligenceResultRead":
        return cls(
            id=result.id,
            discovered_business_id=result.discovered_business_id,
            data_status=result.data_status,
            review_data_source=result.review_data_source,
            google_rating=result.google_rating,
            google_review_count=result.google_review_count,
            reviews_sampled=result.reviews_sampled,
            reviews_with_text=result.reviews_with_text,
            review_activity_level=result.review_activity_level,
            review_frequency_per_month=result.review_frequency_per_month,
            recent_review_count=result.recent_review_count,
            previous_review_count=result.previous_review_count,
            last_review_at=result.last_review_at,
            review_volume_trend=result.review_volume_trend,
            review_sentiment_trend=result.review_sentiment_trend,
            rating_distribution=result.rating_distribution,
            review_health_score=result.review_health_score,
            review_health_factors=[ReviewHealthFactor.model_validate(f) for f in result.review_health_factors],
            themes_data_sufficient=result.themes_data_sufficient,
            positive_review_themes=[ReviewTheme.model_validate(t) for t in result.positive_review_themes],
            negative_review_themes=[ReviewTheme.model_validate(t) for t in result.negative_review_themes],
            review_summary=result.review_summary,
            review_summary_unavailable_reason=result.review_summary_unavailable_reason,
            review_evidence=[ReviewEvidenceItem.model_validate(e) for e in result.review_evidence],
            data_limitations=result.data_limitations,
            review_data_updated_at=result.review_data_updated_at,
        )


class ReviewIntelligenceSummary(BaseModel):
    """The compact projection folded into the Review Queue row and the
    CRM Lead — see modules/discovery/service.py::list_review_items and
    modules/leads/service.py. Never recomputed there; always read
    straight off the latest ReviewIntelligenceResult."""

    google_rating: float | None
    google_review_count: int | None
    review_health_score: int | None
    review_activity_level: ReviewActivityLevel | None
    review_frequency_per_month: float | None
    review_sentiment_trend: ReviewSentimentTrend | None
    positive_review_themes: list[str]
    negative_review_themes: list[str]
    review_summary: str | None
    review_data_updated_at: datetime | None
