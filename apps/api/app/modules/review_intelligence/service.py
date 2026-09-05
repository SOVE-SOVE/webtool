import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import review_intelligence as review_intelligence_agent
from app.agents.review_intelligence import ReviewIntelligenceInput, ReviewInput
from app.integrations import places
from app.integrations.discovery.google_places_provider import GooglePlacesDiscoveryProvider
from app.modules.activity_log import service as activity_service
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.review_intelligence.models import ReviewDataStatus, ReviewIntelligenceResult
from app.modules.review_intelligence.schemas import ReviewIntelligenceResultRead, ReviewIntelligenceSummary

# How long a review analysis stays "fresh enough" that re-analyzing is
# skipped — shorter than business_research's 7 days (RESEARCH_FRESHNESS)
# since a rating/review-count can move week to week, but still bounded
# so an operator opening the same business repeatedly doesn't re-hit
# Google's API (respecting quota, per the "don't continuously call
# Google" requirement).
REVIEW_INTELLIGENCE_FRESHNESS = timedelta(hours=24)


def _get_discovered_business(
    db: Session, workspace_id: uuid.UUID, discovered_business_id: uuid.UUID
) -> DiscoveredBusiness | None:
    return db.scalar(
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id == discovered_business_id)
    )


def get_latest_review_intelligence(db: Session, discovered_business_id: uuid.UUID) -> ReviewIntelligenceResult | None:
    return db.scalar(
        select(ReviewIntelligenceResult)
        .where(ReviewIntelligenceResult.discovered_business_id == discovered_business_id)
        .order_by(ReviewIntelligenceResult.review_data_updated_at.desc())
        .limit(1)
    )


def get_review_summary(db: Session, discovered_business_id: uuid.UUID) -> ReviewIntelligenceSummary | None:
    """The compact projection used by the Review Queue and the CRM Lead
    — never recomputed, always read straight off the latest result."""
    latest = get_latest_review_intelligence(db, discovered_business_id)
    if latest is None:
        return None
    return ReviewIntelligenceSummary(
        google_rating=latest.google_rating,
        google_review_count=latest.google_review_count,
        review_health_score=latest.review_health_score,
        review_activity_level=latest.review_activity_level,
        review_frequency_per_month=latest.review_frequency_per_month,
        review_sentiment_trend=latest.review_sentiment_trend,
        positive_review_themes=[t["theme"] for t in latest.positive_review_themes],
        negative_review_themes=[t["theme"] for t in latest.negative_review_themes],
        review_summary=latest.review_summary,
        review_data_updated_at=latest.review_data_updated_at,
    )


def _persist(db: Session, business: DiscoveredBusiness, output, *, place_id: str | None) -> ReviewIntelligenceResult:
    row = ReviewIntelligenceResult(
        discovered_business_id=business.id,
        data_status=ReviewDataStatus(output.data_status),
        google_place_id=place_id,
        google_rating=output.google_rating,
        google_review_count=output.google_review_count,
        reviews_sampled=output.reviews_sampled,
        reviews_with_text=output.reviews_with_text,
        review_activity_level=output.review_activity_level,
        review_frequency_per_month=output.review_frequency_per_month,
        recent_review_count=output.recent_review_count,
        previous_review_count=output.previous_review_count,
        last_review_at=output.last_review_at,
        review_volume_trend=output.review_volume_trend,
        review_sentiment_trend=output.review_sentiment_trend,
        rating_distribution=output.rating_distribution,
        review_health_score=output.review_health_score,
        review_health_factors=[f.model_dump(mode="json") for f in output.review_health_factors],
        themes_data_sufficient=output.themes_data_sufficient,
        positive_review_themes=[t.model_dump(mode="json") for t in output.positive_review_themes],
        negative_review_themes=[t.model_dump(mode="json") for t in output.negative_review_themes],
        review_summary=output.review_summary,
        review_summary_unavailable_reason=output.review_summary_unavailable_reason,
        review_evidence=[e.model_dump(mode="json") for e in output.review_evidence],
        data_limitations=output.data_limitations,
    )
    db.add(row)
    db.flush()

    # Cached onto the business for the Review Queue's fast list — same
    # "denormalized read-model" reasoning as DiscoveredBusiness.opportunity_score.
    business.google_rating = output.google_rating
    business.google_review_count = output.google_review_count
    business.review_health_score = output.review_health_score
    business.review_activity_level = output.review_activity_level
    return row


def run_review_intelligence(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, discovered_business_id: uuid.UUID
) -> ReviewIntelligenceResultRead | None:
    """
    Returns a fresh-enough cached result without re-fetching when one
    exists (see REVIEW_INTELLIGENCE_FRESHNESS). When Google is
    momentarily unavailable but a prior good result exists, serves that
    stale-but-real result rather than overwriting it with a blank
    "unavailable" row — a transient outage must never make the UI regress
    from real data to "unavailable". Returns None when the business
    doesn't exist in this workspace, so the route can 404.
    """
    business = _get_discovered_business(db, workspace_id, discovered_business_id)
    if business is None:
        return None

    latest = get_latest_review_intelligence(db, business.id)
    now = datetime.now(timezone.utc)
    if (
        latest is not None
        and latest.data_status == ReviewDataStatus.OK
        and now - latest.review_data_updated_at < REVIEW_INTELLIGENCE_FRESHNESS
    ):
        return ReviewIntelligenceResultRead.from_model(latest)

    has_listing = business.source_provider == GooglePlacesDiscoveryProvider.name and bool(business.source_external_id)
    place_id = business.source_external_id if has_listing else None

    if not has_listing:
        result = review_intelligence_agent.run(
            ReviewIntelligenceInput(business_name=business.name, has_listing=False, api_ok=False)
        )
        row = _persist(db, business, result.output, place_id=None)
    else:
        details = places.get_place_details(place_id)
        if details is None:
            if latest is not None:
                # Serve the stale-but-real prior result rather than
                # clobbering it with a blank "unavailable" row.
                return ReviewIntelligenceResultRead.from_model(latest)
            result = review_intelligence_agent.run(
                ReviewIntelligenceInput(business_name=business.name, has_listing=True, api_ok=False)
            )
            row = _persist(db, business, result.output, place_id=place_id)
        else:
            reviews = [
                ReviewInput(
                    rating=r.rating,
                    text=r.text,
                    author_name=r.author_name,
                    published_at=_parse_timestamp(r.published_at),
                    relative_time_description=r.relative_time_description,
                )
                for r in details.reviews
            ]
            result = review_intelligence_agent.run(
                ReviewIntelligenceInput(
                    business_name=business.name,
                    has_listing=True,
                    api_ok=True,
                    google_rating=details.rating,
                    google_review_count=details.user_rating_count,
                    reviews=reviews,
                    now=now,
                )
            )
            row = _persist(db, business, result.output, place_id=place_id)

            activity_service.record(
                db,
                workspace_id=workspace_id,
                user_id=actor_id,
                entity_type="discovered_business",
                entity_id=business.id,
                action="review_analyzed",
                summary=f"Google review analysis for {business.name}: "
                + (
                    f"{result.output.google_rating}★ ({result.output.google_review_count} reviews), "
                    f"health {result.output.review_health_score}"
                    if result.output.review_health_score is not None
                    else "no rating available"
                ),
            )

    db.commit()
    db.refresh(row)
    return ReviewIntelligenceResultRead.from_model(row)


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def list_review_intelligence_results(db: Session, discovered_business_id: uuid.UUID) -> list[ReviewIntelligenceResultRead]:
    query = (
        select(ReviewIntelligenceResult)
        .where(ReviewIntelligenceResult.discovered_business_id == discovered_business_id)
        .order_by(ReviewIntelligenceResult.review_data_updated_at.desc())
    )
    return [ReviewIntelligenceResultRead.from_model(r) for r in db.scalars(query)]
