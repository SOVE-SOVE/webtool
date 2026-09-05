import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.discovery.models import DiscoveredBusiness


class ReviewDataStatus(str, enum.Enum):
    """What actually happened the last time review data was fetched —
    distinct from the review metrics themselves, so the UI can tell
    "we checked and there's genuinely no Google listing" apart from
    "Google was unreachable, this may just be stale/unknown"."""

    OK = "ok"
    UNAVAILABLE = "unavailable"
    NO_LISTING = "no_listing"


class ReviewActivityLevel(str, enum.Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"


class ReviewVolumeTrend(str, enum.Enum):
    """Is the *rate* of new reviews increasing — section 3 of the spec.
    Distinct from ReviewSentimentTrend (are reviews getting more
    positive), which is a separate signal."""

    INCREASING = "increasing"
    STABLE = "stable"
    DECLINING = "declining"
    INSUFFICIENT_DATA = "insufficient_data"


class ReviewSentimentTrend(str, enum.Enum):
    IMPROVING = "improving"
    STABLE = "stable"
    DECLINING = "declining"
    INSUFFICIENT_DATA = "insufficient_data"


class ReviewIntelligenceResult(Base):
    """
    Google review intelligence for one `DiscoveredBusiness` — a sibling
    to BusinessResearchResult/WebsiteQualityAudit/OpportunityScoreResult,
    same "keep full history, newest first" convention (review data can be
    refreshed later — see service.REVIEW_INTELLIGENCE_FRESHNESS).

    Google Places API (New) never exposes a business's complete review
    history: it returns one aggregate `rating` + `userRatingCount`, plus
    at most 5 individual reviews (Google's own pick of "most relevant",
    not guaranteed to be the most recent). Every metric here is computed
    honestly from *only* that sample — `rating_distribution` is therefore
    always null for this provider (a 5-review sample cannot responsibly
    stand in for a business's true star distribution, see the explicit
    "do not reconstruct from the average" requirement), and
    frequency/trend/theme fields fall back to their
    insufficient-data/unknown values whenever the sample is too thin to
    say something real. `data_limitations` spells out why, in plain
    language, for the UI to surface directly.
    """

    __tablename__ = "review_intelligence_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    discovered_business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("discovered_businesses.id", ondelete="CASCADE")
    )

    data_status: Mapped[ReviewDataStatus] = mapped_column(
        Enum(ReviewDataStatus, name="review_data_status"), default=ReviewDataStatus.UNAVAILABLE
    )
    review_data_source: Mapped[str] = mapped_column(String(50), default="google_places")
    google_place_id: Mapped[str | None] = mapped_column(String(500))

    google_rating: Mapped[float | None] = mapped_column(Float)
    google_review_count: Mapped[int | None] = mapped_column(Integer)
    # How many individual reviews Google actually returned (<=5) and, of
    # those, how many had text — the honest denominator behind every
    # theme/frequency/trend calculation below.
    reviews_sampled: Mapped[int] = mapped_column(Integer, default=0)
    reviews_with_text: Mapped[int] = mapped_column(Integer, default=0)

    review_activity_level: Mapped[ReviewActivityLevel] = mapped_column(
        Enum(ReviewActivityLevel, name="review_activity_level"), default=ReviewActivityLevel.UNKNOWN
    )
    review_frequency_per_month: Mapped[float | None] = mapped_column(Float)
    recent_review_count: Mapped[int | None] = mapped_column(Integer)
    previous_review_count: Mapped[int | None] = mapped_column(Integer)
    last_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_volume_trend: Mapped[ReviewVolumeTrend] = mapped_column(
        Enum(ReviewVolumeTrend, name="review_volume_trend"), default=ReviewVolumeTrend.INSUFFICIENT_DATA
    )
    review_sentiment_trend: Mapped[ReviewSentimentTrend] = mapped_column(
        Enum(ReviewSentimentTrend, name="review_sentiment_trend"), default=ReviewSentimentTrend.INSUFFICIENT_DATA
    )

    # Always null for review_data_source="google_places" — see class
    # docstring. Kept as a real column (not just omitted) so a future
    # provider that genuinely supports a full distribution can populate
    # it without a schema change.
    rating_distribution: Mapped[dict | None] = mapped_column(JSON)

    review_health_score: Mapped[int | None] = mapped_column(Integer)
    # [{factor, points, direction, explanation}] — same explainable-score
    # precedent as OpportunityScoreResult.factors.
    review_health_factors: Mapped[list] = mapped_column(JSON, default=list)

    # Whether reviews_with_text cleared the bar for theme extraction to
    # mean anything (see agents/review_intelligence.py MIN_REVIEWS_FOR_THEMES).
    # False + empty lists = "insufficient data"; True + empty lists =
    # "no recurring theme found" — two different, non-interchangeable
    # messages the UI must not blur together.
    themes_data_sufficient: Mapped[bool] = mapped_column(Boolean, default=False)
    # [{theme, occurrences, confidence, evidence: [snippet, ...]}]
    positive_review_themes: Mapped[list] = mapped_column(JSON, default=list)
    negative_review_themes: Mapped[list] = mapped_column(JSON, default=list)

    review_summary: Mapped[str | None] = mapped_column(Text)
    # Populated instead of review_summary when the deterministic metrics
    # above all succeeded but the LLM call itself failed/was unavailable
    # — the rest of the analysis is still persisted and shown.
    review_summary_unavailable_reason: Mapped[str | None] = mapped_column(Text)

    # Short supporting snippets for the themes/trend/summary above —
    # never more review text than Google's own API returned to us.
    # [{rating, snippet, published_at, relative_time_description}]
    review_evidence: Mapped[list] = mapped_column(JSON, default=list)

    data_limitations: Mapped[str | None] = mapped_column(Text)

    review_data_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    discovered_business: Mapped["DiscoveredBusiness"] = relationship(back_populates="review_intelligence_results")
