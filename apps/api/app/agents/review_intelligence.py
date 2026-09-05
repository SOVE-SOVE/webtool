"""
Google review intelligence — turns whatever Google Places actually gave
us (an aggregate rating/count plus at most 5 individual reviews, see
integrations/places.py's DETAILS_FIELD_MASK docstring) into a reputation
snapshot: activity level, recent-activity/trend, an explainable 0-100
health score, recurring praise/friction themes, and a short AI summary.

Every deterministic figure here is computed straight off the reviews
it's given — never fabricated, never reconstructed from the average
rating alone. Google's API caps the individual-review sample at 5, so in
real usage most of the frequency/trend/theme fields will honestly land
on their "insufficient data" branch; the thresholds below are
deliberately documented constants (not tuned to always produce a
confident-looking answer) so that's the correct, expected outcome for a
typical small business, not a bug.

The one LLM call in this module (via integrations/llm.py) only ever
receives these already-computed facts and verbatim review snippets — it
is not shown raw, unfiltered review text to freely interpret, and it's
explicitly instructed not to go beyond what it's given (see
agents/prompts/review_intelligence.md).
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.llm import LlmUnavailableError, generate_structured
from pathlib import Path

PROMPT_VERSION = "review_intelligence-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "review_intelligence.md"

# --- Documented deterministic thresholds -------------------------------------

RECENT_WINDOW_DAYS = 90

# A rate needs at least this many dated reviews, spanning at least this
# many days, before "reviews per month" means anything — otherwise two
# reviews three days apart would imply an absurd monthly rate.
MIN_DATED_REVIEWS_FOR_FREQUENCY = 3
MIN_SPAN_DAYS_FOR_FREQUENCY = 14

# Roughly one review/week is a strongly active flow for a local
# business; ~monthly is modest but ongoing; anything computed below that
# is LOW rather than UNKNOWN (a rate was computable, it's just slow).
ACTIVITY_HIGH_PER_MONTH = 4.0
ACTIVITY_MEDIUM_PER_MONTH = 1.0

# A volume trend (more/fewer reviews lately) needs at least one dated
# review in each 90-day window to say anything directional.
MIN_DATED_REVIEWS_FOR_VOLUME_TREND = 3

# A sentiment trend needs enough dated+rated reviews to split into an
# "earlier" and "later" half meaningfully.
MIN_DATED_REVIEWS_FOR_SENTIMENT_TREND = 4
SENTIMENT_TREND_THRESHOLD = 0.75  # average-rating points, on a 1-5 scale

# A theme needs at least this many independent reviews behind it before
# it's "recurring" rather than one person's opinion; the sample itself
# needs at least this many reviews with text before we'll say anything
# at all about themes (including "no complaints found").
MIN_REVIEWS_FOR_THEMES = 3
THEME_MIN_OCCURRENCES = 2

# Bayesian smoothing for the rating component of the health score: pulls
# a rating with few reviews toward this prior mean, weighted by this
# many "virtual" prior reviews — the mechanism that keeps "5.0 from 4
# reviews" from beating "4.8 from 400 reviews". This is a scoring-formula
# constant, not a claim about what any particular business's rating is.
RATING_PRIOR_MEAN = 4.0
RATING_PRIOR_WEIGHT = 10

_ACTIVITY_POINTS = {"high": 15, "medium": 9, "low": 4, "unknown": 0}

POSITIVE_THEME_LEXICON: dict[str, tuple[str, ...]] = {
    "Friendly staff": ("friendly staff", "friendly team", "so friendly", "really friendly", "staff were friendly"),
    "Quality of service": (
        "quality of service",
        "quality service",
        "great service",
        "excellent service",
        "quality work",
        "quality of work",
    ),
    "Professionalism": ("professional", "professionalism"),
    "Great results": (
        "great results",
        "amazing results",
        "fantastic results",
        "exceeded my expectations",
        "exceeded expectations",
    ),
    "Good communication": (
        "great communication",
        "good communication",
        "communicated well",
        "kept me updated",
        "kept us updated",
    ),
    "Clean environment": ("clean and tidy", "very clean", "spotless", "clean environment"),
    "Value for money": (
        "value for money",
        "good value",
        "fair price",
        "reasonably priced",
        "worth the money",
        "worth every",
    ),
    "Responsiveness": ("quick response", "responded quickly", "fast response", "prompt service"),
}

NEGATIVE_THEME_LEXICON: dict[str, tuple[str, ...]] = {
    "Wait times": ("long wait", "waited a long time", "kept waiting", "long wait time"),
    "Appointment availability": (
        "hard to book",
        "difficult to get an appointment",
        "no availability",
        "booked out",
        "couldn't get an appointment",
        "could not get an appointment",
    ),
    "Communication problems": (
        "poor communication",
        "lack of communication",
        "didn't communicate",
        "did not communicate",
        "no response",
        "never responded",
        "hard to reach",
    ),
    "Pricing concerns": ("overpriced", "too expensive", "expensive for", "hidden fees", "price was high"),
    "Service delays": ("delayed", "took longer than expected", "behind schedule", "late arriv"),
}


class ReviewInput(BaseModel):
    rating: int | None = None
    text: str | None = None
    author_name: str | None = None
    published_at: datetime | None = None
    relative_time_description: str | None = None


class ReviewIntelligenceInput(BaseModel):
    business_name: str
    has_listing: bool
    api_ok: bool
    google_rating: float | None = None
    google_review_count: int | None = None
    reviews: list[ReviewInput] = []
    now: datetime | None = None


class ThemeOutput(BaseModel):
    theme: str
    occurrences: int
    confidence: float
    evidence: list[str] = []


class HealthFactor(BaseModel):
    factor: str
    points: float
    direction: Literal["positive", "negative", "neutral"]
    explanation: str


class EvidenceItem(BaseModel):
    rating: int | None
    snippet: str
    published_at: datetime | None
    relative_time_description: str | None


class ReviewIntelligenceOutput(BaseModel):
    data_status: Literal["ok", "unavailable", "no_listing"]
    google_rating: float | None = None
    google_review_count: int | None = None
    reviews_sampled: int = 0
    reviews_with_text: int = 0

    review_activity_level: Literal["high", "medium", "low", "unknown"] = "unknown"
    review_frequency_per_month: float | None = None
    recent_review_count: int | None = None
    previous_review_count: int | None = None
    last_review_at: datetime | None = None
    review_volume_trend: Literal["increasing", "stable", "declining", "insufficient_data"] = "insufficient_data"
    review_sentiment_trend: Literal["improving", "stable", "declining", "insufficient_data"] = "insufficient_data"

    rating_distribution: dict[str, float] | None = None

    review_health_score: int | None = None
    review_health_factors: list[HealthFactor] = []

    themes_data_sufficient: bool = False
    positive_review_themes: list[ThemeOutput] = []
    negative_review_themes: list[ThemeOutput] = []

    review_summary: str | None = None
    review_summary_unavailable_reason: str | None = None
    review_evidence: list[EvidenceItem] = []

    data_limitations: str | None = None


_GOOGLE_SAMPLE_CAVEAT = (
    "Google Places only returns up to 5 individual reviews per business (its own pick of "
    "\"most relevant\", not guaranteed to be the most recent), and never exposes a full "
    "review history or a star-by-star breakdown — every figure below is computed from that "
    "small sample, not the business's complete review history."
)


def _snippet(text: str, limit: int = 160) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _dated_reviews(reviews: list[ReviewInput]) -> list[ReviewInput]:
    return [r for r in reviews if r.published_at is not None]


def _compute_frequency(dated: list[ReviewInput], now: datetime) -> tuple[float | None, str]:
    """Returns (reviews_per_month, activity_level). None/unknown unless
    there's a real span of dated reviews to divide across — see
    MIN_DATED_REVIEWS_FOR_FREQUENCY / MIN_SPAN_DAYS_FOR_FREQUENCY."""
    if len(dated) < MIN_DATED_REVIEWS_FOR_FREQUENCY:
        return None, "unknown"
    oldest = min(r.published_at for r in dated)
    newest = max(r.published_at for r in dated)
    span_days = (newest - oldest).days
    if span_days < MIN_SPAN_DAYS_FOR_FREQUENCY:
        return None, "unknown"
    per_month = len(dated) / (span_days / 30.44)
    if per_month >= ACTIVITY_HIGH_PER_MONTH:
        level = "high"
    elif per_month >= ACTIVITY_MEDIUM_PER_MONTH:
        level = "medium"
    else:
        level = "low"
    return round(per_month, 1), level


def _compute_recent_activity(dated: list[ReviewInput], now: datetime) -> tuple[int, int]:
    recent_cutoff = now - timedelta(days=RECENT_WINDOW_DAYS)
    previous_cutoff = now - timedelta(days=2 * RECENT_WINDOW_DAYS)
    recent = sum(1 for r in dated if r.published_at >= recent_cutoff)
    previous = sum(1 for r in dated if previous_cutoff <= r.published_at < recent_cutoff)
    return recent, previous


def _compute_volume_trend(recent: int, previous: int, dated_count: int) -> str:
    if dated_count < MIN_DATED_REVIEWS_FOR_VOLUME_TREND or recent + previous == 0:
        return "insufficient_data"
    if recent == previous:
        return "stable"
    return "increasing" if recent > previous else "declining"


def _compute_sentiment_trend(dated: list[ReviewInput]) -> str:
    rated = [r for r in dated if r.rating is not None]
    if len(rated) < MIN_DATED_REVIEWS_FOR_SENTIMENT_TREND:
        return "insufficient_data"
    ordered = sorted(rated, key=lambda r: r.published_at)
    mid = len(ordered) // 2
    older_half, recent_half = ordered[:mid], ordered[mid:]
    older_avg = sum(r.rating for r in older_half) / len(older_half)
    recent_avg = sum(r.rating for r in recent_half) / len(recent_half)
    delta = recent_avg - older_avg
    if delta >= SENTIMENT_TREND_THRESHOLD:
        return "improving"
    if delta <= -SENTIMENT_TREND_THRESHOLD:
        return "declining"
    return "stable"


def _extract_themes(
    reviews: list[ReviewInput], lexicon: dict[str, tuple[str, ...]], want_rating: Literal["positive", "negative"]
) -> list[ThemeOutput]:
    candidate_reviews = [
        r for r in reviews if r.text and r.rating is not None and (r.rating >= 4 if want_rating == "positive" else r.rating <= 2)
    ]
    if not candidate_reviews:
        return []
    themes: list[ThemeOutput] = []
    for theme, keywords in lexicon.items():
        matches = [r for r in candidate_reviews if any(k in r.text.lower() for k in keywords)]
        if len(matches) < THEME_MIN_OCCURRENCES:
            continue
        themes.append(
            ThemeOutput(
                theme=theme,
                occurrences=len(matches),
                confidence=round(len(matches) / len(candidate_reviews), 2),
                evidence=[_snippet(r.text) for r in matches[:2]],
            )
        )
    themes.sort(key=lambda t: t.occurrences, reverse=True)
    return themes


def _health_score(
    *,
    google_rating: float | None,
    google_review_count: int | None,
    activity_level: str,
    last_review_at: datetime | None,
    now: datetime,
    positive_themes: list[ThemeOutput],
    negative_themes: list[ThemeOutput],
    sentiment_trend: str,
) -> tuple[int | None, list[HealthFactor]]:
    """0-100, built from several independently-explainable factors so a
    high review *count* alone can never dominate — see the Bayesian
    rating-smoothing note on RATING_PRIOR_WEIGHT for how "5.0 from 4
    reviews" is kept from beating "4.8 from 400 reviews"."""
    if google_rating is None:
        return None, []

    review_count = google_review_count or 0
    weighted_rating = (review_count / (review_count + RATING_PRIOR_WEIGHT)) * google_rating + (
        RATING_PRIOR_WEIGHT / (review_count + RATING_PRIOR_WEIGHT)
    ) * RATING_PRIOR_MEAN
    rating_points = max(0.0, (weighted_rating - 1) / 4 * 50)
    factors = [
        HealthFactor(
            factor="Rating (volume-weighted)",
            points=round(rating_points, 1),
            direction="positive" if weighted_rating >= RATING_PRIOR_MEAN else "negative",
            explanation=(
                f"{google_rating:.1f}★ from {review_count} review(s), smoothed toward a "
                f"{RATING_PRIOR_MEAN:.1f} baseline so a handful of reviews can't outscore a large, "
                f"consistently-rated history"
            ),
        )
    ]

    if review_count >= 200:
        volume_points = 15
    elif review_count >= 50:
        volume_points = 12
    elif review_count >= 20:
        volume_points = 9
    elif review_count >= 5:
        volume_points = 6
    elif review_count >= 1:
        volume_points = 3
    else:
        volume_points = 0
    factors.append(
        HealthFactor(
            factor="Review volume",
            points=volume_points,
            direction="positive" if volume_points > 0 else "neutral",
            explanation=f"{review_count} total Google review(s) on record",
        )
    )

    activity_points = _ACTIVITY_POINTS[activity_level]
    factors.append(
        HealthFactor(
            factor="Review activity",
            points=activity_points,
            direction="positive" if activity_points >= 9 else "neutral",
            explanation=f"Review activity classified as {activity_level.upper()}",
        )
    )

    if last_review_at is None:
        recency_points = 0
        recency_note = "No dated reviews available"
    else:
        days_since = (now - last_review_at).days
        if days_since <= 30:
            recency_points = 10
        elif days_since <= 90:
            recency_points = 7
        elif days_since <= 365:
            recency_points = 4
        else:
            recency_points = 0
        recency_note = f"Most recent visible review was {days_since} day(s) ago"
    factors.append(
        HealthFactor(
            factor="Recency",
            points=recency_points,
            direction="positive" if recency_points >= 7 else "neutral",
            explanation=recency_note,
        )
    )

    if not positive_themes and not negative_themes:
        sentiment_points = 5.0
        sentiment_note = "Not enough review text to assess recurring themes"
        direction: Literal["positive", "negative", "neutral"] = "neutral"
    elif not negative_themes:
        sentiment_points = 10.0
        sentiment_note = "No recurring negative themes found against confirmed recurring praise"
        direction = "positive"
    elif len(positive_themes) > len(negative_themes):
        sentiment_points = 6.0
        sentiment_note = "Recurring praise outweighs recurring friction points"
        direction = "positive"
    else:
        sentiment_points = 2.0
        sentiment_note = "Recurring friction points match or outweigh recurring praise"
        direction = "negative"
    factors.append(
        HealthFactor(factor="Sentiment consistency", points=sentiment_points, direction=direction, explanation=sentiment_note)
    )

    trend_adjustment = 0.0
    if sentiment_trend == "improving":
        trend_adjustment = 5.0
        factors.append(
            HealthFactor(
                factor="Sentiment trend", points=5.0, direction="positive", explanation="Recent reviews trend more positive than earlier ones"
            )
        )
    elif sentiment_trend == "declining":
        trend_adjustment = -5.0
        factors.append(
            HealthFactor(
                factor="Sentiment trend", points=-5.0, direction="negative", explanation="Recent reviews trend more negative than earlier ones"
            )
        )

    total = sum(f.points for f in factors)
    return round(max(0.0, min(100.0, total))), factors


def _build_summary_user_message(
    business_name: str,
    output: ReviewIntelligenceOutput,
) -> str:
    lines = [
        f"Business: {business_name}",
        f"Google rating: {output.google_rating if output.google_rating is not None else 'not available'}",
        f"Google review count: {output.google_review_count if output.google_review_count is not None else 'not available'}",
        f"Reviews with text available to analyze: {output.reviews_with_text} (of {output.reviews_sampled} sampled via the API)",
        f"Review activity level: {output.review_activity_level}"
        + (f" (~{output.review_frequency_per_month}/month)" if output.review_frequency_per_month else ""),
        f"Review volume trend: {output.review_volume_trend}",
        f"Review sentiment trend: {output.review_sentiment_trend}",
    ]
    if output.positive_review_themes:
        lines.append(
            "Recurring positive themes: "
            + "; ".join(f"{t.theme} ({t.occurrences} review(s))" for t in output.positive_review_themes)
        )
    else:
        lines.append("Recurring positive themes: none identified")
    if output.negative_review_themes:
        lines.append(
            "Recurring negative/friction themes: "
            + "; ".join(f"{t.theme} ({t.occurrences} review(s))" for t in output.negative_review_themes)
        )
    else:
        lines.append("Recurring negative/friction themes: none identified")
    if output.review_evidence:
        lines.append("Verbatim review snippets (evidence, do not exceed this):")
        for e in output.review_evidence:
            lines.append(f"- ({e.rating if e.rating is not None else '?'}★) \"{e.snippet}\"")
    return "\n".join(lines)


def run(input: ReviewIntelligenceInput) -> AgentResult[ReviewIntelligenceOutput]:
    now = input.now or datetime.now(timezone.utc)

    if not input.has_listing:
        output = ReviewIntelligenceOutput(
            data_status="no_listing",
            data_limitations="No Google Places listing is on record for this business — review data can't be collected.",
        )
        return AgentResult(output=output, confidence=1.0, notes="No Google listing on record.")

    if not input.api_ok:
        output = ReviewIntelligenceOutput(
            data_status="unavailable",
            data_limitations="Google Places is currently unavailable (no API key configured, or the request failed).",
        )
        return AgentResult(
            output=output, confidence=0.0, flagged_for_review=True, notes="Google Places API call failed or is unconfigured."
        )

    reviews = input.reviews
    dated = _dated_reviews(reviews)
    reviews_with_text = sum(1 for r in reviews if r.text)

    frequency, activity_level = _compute_frequency(dated, now)
    recent_count, previous_count = _compute_recent_activity(dated, now) if dated else (None, None)
    volume_trend = _compute_volume_trend(recent_count or 0, previous_count or 0, len(dated)) if dated else "insufficient_data"
    sentiment_trend = _compute_sentiment_trend(dated)
    last_review_at = max((r.published_at for r in dated), default=None)

    themes_sufficient = reviews_with_text >= MIN_REVIEWS_FOR_THEMES
    positive_themes = _extract_themes(reviews, POSITIVE_THEME_LEXICON, "positive") if themes_sufficient else []
    negative_themes = _extract_themes(reviews, NEGATIVE_THEME_LEXICON, "negative") if themes_sufficient else []

    evidence = [
        EvidenceItem(rating=r.rating, snippet=_snippet(r.text), published_at=r.published_at, relative_time_description=r.relative_time_description)
        for r in reviews
        if r.text
    ][:5]

    health_score, health_factors = _health_score(
        google_rating=input.google_rating,
        google_review_count=input.google_review_count,
        activity_level=activity_level,
        last_review_at=last_review_at,
        now=now,
        positive_themes=positive_themes,
        negative_themes=negative_themes,
        sentiment_trend=sentiment_trend,
    )

    limitations = _GOOGLE_SAMPLE_CAVEAT
    if not themes_sufficient:
        limitations += (
            f" Only {reviews_with_text} review(s) with text were available — too few to identify recurring "
            "themes with confidence."
        )

    output = ReviewIntelligenceOutput(
        data_status="ok",
        google_rating=input.google_rating,
        google_review_count=input.google_review_count,
        reviews_sampled=len(reviews),
        reviews_with_text=reviews_with_text,
        review_activity_level=activity_level,
        review_frequency_per_month=frequency,
        recent_review_count=recent_count,
        previous_review_count=previous_count,
        last_review_at=last_review_at,
        review_volume_trend=volume_trend,
        review_sentiment_trend=sentiment_trend,
        rating_distribution=None,
        review_health_score=health_score,
        review_health_factors=health_factors,
        themes_data_sufficient=themes_sufficient,
        positive_review_themes=positive_themes,
        negative_review_themes=negative_themes,
        review_evidence=evidence,
        data_limitations=limitations,
    )

    # --- AI summary: a thin layer over the facts already computed above ---
    if input.google_review_count == 0 or input.google_rating is None:
        output.review_summary = f"{input.business_name} has no Google reviews yet."
    elif reviews_with_text == 0:
        output.review_summary = (
            f"{input.business_name} has a {input.google_rating:.1f}★ Google rating from "
            f"{input.google_review_count} review(s), but no review text is available via the API to "
            "summarize what customers are saying."
        )
    else:
        try:
            schema = {
                "type": "object",
                "properties": {"summary": {"type": "string"}},
                "required": ["summary"],
            }
            raw = generate_structured(
                system=_PROMPT_PATH.read_text(encoding="utf-8"),
                user=_build_summary_user_message(input.business_name, output),
                schema=schema,
                max_tokens=400,
            )
            output.review_summary = raw.get("summary")
        except LlmUnavailableError as exc:
            output.review_summary_unavailable_reason = str(exc)

    thin_evidence = reviews_with_text < MIN_REVIEWS_FOR_THEMES
    return AgentResult(
        output=output,
        confidence=0.5 if thin_evidence else 0.85,
        flagged_for_review=thin_evidence,
        notes=f"Only {reviews_with_text} review(s) with text were available via the Google Places API."
        if thin_evidence
        else None,
    )
