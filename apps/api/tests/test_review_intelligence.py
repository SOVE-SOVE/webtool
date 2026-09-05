"""
Google Review Intelligence — a reputation snapshot computed only from
what Google Places (New) actually returns: an aggregate rating/count
plus at most 5 individual reviews (never a full review history, never a
star-by-star breakdown). Every test here either verifies a deterministic
calculation directly against the agent, or verifies the service layer's
persistence/caching/freshness/degrade-gracefully behavior against a
mocked Google Places call — never against the live API.

The central anti-fabrication guarantees under test:
- rating_distribution is always None for this provider (never
  reconstructed from the average rating).
- A business with a high rating but very few reviews never outscores one
  with a slightly lower rating but many reviews (the explicit "5.0/4
  reviews must not beat 4.8/400 reviews" requirement).
- Every frequency/trend/theme field falls back to its
  unknown/insufficient-data value rather than a fabricated one when the
  sample is too thin — and the AI summary is never generated from
  anything but those same computed facts.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.agents import review_intelligence as review_intelligence_agent
from app.agents.review_intelligence import ReviewInput, ReviewIntelligenceInput
from app.integrations import places
from app.integrations.discovery.google_places_provider import GooglePlacesDiscoveryProvider
from app.core.settings import settings
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.review_intelligence import service as review_intelligence_service

NOW = datetime(2026, 9, 5, tzinfo=timezone.utc)


def _review(days_ago: int, rating: int | None = None, text: str | None = None) -> ReviewInput:
    return ReviewInput(
        rating=rating,
        text=text,
        published_at=NOW - timedelta(days=days_ago),
        relative_time_description=f"{days_ago} days ago",
    )


# --- Agent: edge cases (no listing / API unavailable) ------------------------


def test_no_listing_produces_no_listing_status_and_no_fake_values():
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(business_name="Acme Plumbing", has_listing=False, api_ok=False)
    )
    assert result.output.data_status == "no_listing"
    assert result.output.google_rating is None
    assert result.output.google_review_count is None
    assert result.output.review_health_score is None
    assert result.output.review_summary is None
    assert result.output.data_limitations


def test_api_unavailable_flags_for_review_and_invents_nothing():
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(business_name="Acme Plumbing", has_listing=True, api_ok=False)
    )
    assert result.output.data_status == "unavailable"
    assert result.output.google_rating is None
    assert result.flagged_for_review is True


def test_zero_reviews_gives_deterministic_summary_without_calling_llm(monkeypatch):
    def _boom(**kwargs):
        raise AssertionError("LLM should not be called for a business with zero reviews")

    monkeypatch.setattr("app.agents.review_intelligence.generate_structured", _boom)
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme Plumbing", has_listing=True, api_ok=True, google_rating=None, google_review_count=0
        )
    )
    assert result.output.data_status == "ok"
    assert "no Google reviews yet" in result.output.review_summary
    assert result.output.review_health_score is None  # no rating => no score, never a fabricated one
    assert result.output.rating_distribution is None


def test_reviews_with_no_text_gives_deterministic_summary_without_calling_llm(monkeypatch):
    def _boom(**kwargs):
        raise AssertionError("LLM should not be called when no review has text")

    monkeypatch.setattr("app.agents.review_intelligence.generate_structured", _boom)
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme Plumbing",
            has_listing=True,
            api_ok=True,
            google_rating=4.5,
            google_review_count=12,
            reviews=[_review(10, rating=5), _review(40, rating=4)],
            now=NOW,
        )
    )
    assert "no review text is available" in result.output.review_summary


# --- Agent: frequency / activity classification ------------------------------


def test_frequency_insufficient_data_below_minimum_dated_reviews():
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme",
            has_listing=True,
            api_ok=True,
            google_rating=4.5,
            google_review_count=50,
            reviews=[_review(5, rating=5, text="Great job, friendly staff"), _review(10, rating=5, text="Nice")],
            now=NOW,
        )
    )
    assert result.output.review_frequency_per_month is None
    assert result.output.review_activity_level == "unknown"


def test_frequency_high_activity_from_dense_recent_reviews():
    reviews = [_review(d, rating=5, text="great") for d in (2, 8, 15, 22, 29)]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=4.8, google_review_count=300,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.review_frequency_per_month is not None
    assert result.output.review_frequency_per_month >= 4.0
    assert result.output.review_activity_level == "high"


def test_frequency_low_activity_from_sparse_reviews():
    reviews = [_review(d, rating=4, text="fine") for d in (10, 100, 190)]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=4.2, google_review_count=20,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.review_activity_level == "low"


# --- Agent: recent activity + volume trend ------------------------------------


def test_recent_activity_and_increasing_volume_trend():
    reviews = [
        _review(10, rating=5, text="a"),
        _review(30, rating=5, text="b"),
        _review(60, rating=5, text="c"),
        _review(150, rating=5, text="d"),
    ]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=4.7, google_review_count=100,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.recent_review_count == 3
    assert result.output.previous_review_count == 1
    assert result.output.review_volume_trend == "increasing"
    assert result.output.last_review_at == NOW - timedelta(days=10)


def test_volume_trend_insufficient_data_with_too_few_dated_reviews():
    reviews = [_review(10, rating=5, text="a")]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=4.7, google_review_count=100,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.review_volume_trend == "insufficient_data"


# --- Agent: sentiment trend ----------------------------------------------------


def test_sentiment_trend_improving_when_recent_ratings_are_higher():
    reviews = [
        _review(200, rating=3, text="okay experience"),
        _review(150, rating=3, text="okay again"),
        _review(20, rating=5, text="excellent now"),
        _review(5, rating=5, text="fantastic recently"),
    ]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=4.0, google_review_count=50,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.review_sentiment_trend == "improving"


def test_sentiment_trend_declining_when_recent_ratings_are_lower():
    reviews = [
        _review(200, rating=5, text="excellent then"),
        _review(150, rating=5, text="great then too"),
        _review(20, rating=2, text="disappointing now"),
        _review(5, rating=2, text="not good recently"),
    ]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=3.5, google_review_count=50,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.review_sentiment_trend == "declining"


def test_sentiment_trend_insufficient_data_with_too_few_rated_reviews():
    reviews = [_review(10, rating=5, text="a"), _review(20, rating=4, text="b")]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=4.5, google_review_count=50,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.review_sentiment_trend == "insufficient_data"


# --- Agent: review health score ------------------------------------------------


def test_health_score_never_lets_a_tiny_perfect_sample_beat_a_large_strong_one():
    tiny_perfect = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Tiny Co", has_listing=True, api_ok=True, google_rating=5.0, google_review_count=4, now=NOW
        )
    ).output
    large_strong = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Large Co", has_listing=True, api_ok=True, google_rating=4.8, google_review_count=400,
            now=NOW,
        )
    ).output
    assert tiny_perfect.review_health_score is not None
    assert large_strong.review_health_score is not None
    assert large_strong.review_health_score > tiny_perfect.review_health_score


def test_health_score_is_none_without_a_rating():
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=None, google_review_count=0, now=NOW
        )
    )
    assert result.output.review_health_score is None
    assert result.output.review_health_factors == []


def test_health_score_factors_are_all_explainable():
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=4.5, google_review_count=80,
            reviews=[_review(5, rating=5, text="great")], now=NOW,
        )
    )
    assert 0 <= result.output.review_health_score <= 100
    for factor in result.output.review_health_factors:
        assert factor.explanation
        assert factor.direction in ("positive", "negative", "neutral")


# --- Agent: rating distribution — never reconstructed --------------------------


@pytest.mark.parametrize("review_count", [0, 4, 400])
def test_rating_distribution_always_unavailable_for_google_places(review_count):
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme",
            has_listing=True,
            api_ok=True,
            google_rating=4.5 if review_count else None,
            google_review_count=review_count,
            now=NOW,
        )
    )
    assert result.output.rating_distribution is None


# --- Agent: positive/negative theme extraction ---------------------------------


def test_positive_theme_extraction_requires_recurring_evidence():
    reviews = [
        _review(5, rating=5, text="The staff were so friendly and helpful throughout"),
        _review(10, rating=5, text="Really friendly staff, would recommend"),
        _review(20, rating=4, text="Quick and easy, no complaints"),
    ]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=4.7, google_review_count=60,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.themes_data_sufficient is True
    themes = {t.theme for t in result.output.positive_review_themes}
    assert "Friendly staff" in themes
    friendly = next(t for t in result.output.positive_review_themes if t.theme == "Friendly staff")
    assert friendly.occurrences == 2
    assert friendly.evidence  # real snippets, not invented


def test_negative_theme_extraction_requires_recurring_evidence():
    reviews = [
        _review(5, rating=1, text="We waited a long time before anyone helped us"),
        _review(15, rating=2, text="Waited a long time again and it was frustrating"),
        _review(30, rating=5, text="Excellent, no issues at all"),
    ]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=3.5, google_review_count=60,
            reviews=reviews, now=NOW,
        )
    )
    themes = {t.theme for t in result.output.negative_review_themes}
    assert "Wait times" in themes


def test_no_recurring_complaints_when_data_sufficient_but_nothing_matches():
    reviews = [
        _review(5, rating=1, text="Just not what I expected, overall unhappy"),
        _review(15, rating=5, text="Loved it, would come back"),
        _review(30, rating=4, text="Pretty good overall"),
    ]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=3.8, google_review_count=60,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.themes_data_sufficient is True
    assert result.output.negative_review_themes == []


def test_themes_insufficient_data_with_too_few_reviews_with_text():
    reviews = [_review(5, rating=1, text="Waited a long time, frustrating")]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme", has_listing=True, api_ok=True, google_rating=3.8, google_review_count=60,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.themes_data_sufficient is False
    assert result.output.positive_review_themes == []
    assert result.output.negative_review_themes == []
    assert result.flagged_for_review is True


# --- Agent: AI summary ----------------------------------------------------------


def test_ai_summary_uses_only_computed_facts(monkeypatch):
    captured = {}

    def fake_generate_structured(*, system, user, schema, max_tokens=4096):
        captured["user"] = user
        return {"summary": "Customers consistently praise the friendly staff; a small number mention wait times."}

    monkeypatch.setattr("app.agents.review_intelligence.generate_structured", fake_generate_structured)

    reviews = [
        _review(5, rating=5, text="Friendly staff, very friendly team"),
        _review(15, rating=5, text="So friendly and helpful"),
        _review(20, rating=1, text="Waited a long time, kept waiting"),
    ]
    result = review_intelligence_agent.run(
        ReviewIntelligenceInput(
            business_name="Acme Plumbing", has_listing=True, api_ok=True, google_rating=4.3, google_review_count=90,
            reviews=reviews, now=NOW,
        )
    )
    assert result.output.review_summary == (
        "Customers consistently praise the friendly staff; a small number mention wait times."
    )
    # The prompt must be built from computed facts, not raw review text alone.
    assert "Acme Plumbing" in captured["user"]
    assert "Friendly staff" in captured["user"]


def test_ai_summary_unavailable_does_not_block_deterministic_results():
    from app.integrations.llm import LlmUnavailableError

    def _boom(**kwargs):
        raise LlmUnavailableError("no API key configured")

    import app.agents.review_intelligence as mod

    original = mod.generate_structured
    mod.generate_structured = _boom
    try:
        reviews = [_review(5, rating=5, text="Great service, friendly staff, friendly team")]
        result = mod.run(
            ReviewIntelligenceInput(
                business_name="Acme", has_listing=True, api_ok=True, google_rating=4.6, google_review_count=40,
                reviews=reviews, now=NOW,
            )
        )
    finally:
        mod.generate_structured = original

    assert result.output.review_summary is None
    assert result.output.review_summary_unavailable_reason == "no API key configured"
    # Everything computed deterministically is still there.
    assert result.output.google_rating == 4.6
    assert result.output.review_health_score is not None


# --- Service: persistence, caching, freshness, degrade-gracefully -------------


def _make_search(db_session, workspace, **overrides) -> DiscoverySearch:
    defaults = dict(workspace_id=workspace.id, industry="Plumbing", provider="manual")
    defaults.update(overrides)
    search = DiscoverySearch(**defaults)
    db_session.add(search)
    db_session.commit()
    db_session.refresh(search)
    return search


def _make_business(db_session, search, **overrides) -> DiscoveredBusiness:
    defaults = dict(
        discovery_search_id=search.id,
        name="Gold Coast Plumbing Co",
        source_provider="manual",
        dedup_key="gold coast plumbing co||",
    )
    defaults.update(overrides)
    business = DiscoveredBusiness(**defaults)
    db_session.add(business)
    db_session.commit()
    db_session.refresh(business)
    return business


def test_service_returns_none_for_unknown_business(db_session, workspace, admin_user):
    assert (
        review_intelligence_service.run_review_intelligence(db_session, workspace.id, admin_user.id, uuid.uuid4())
        is None
    )


def test_service_no_google_listing_persists_no_listing_row(db_session, workspace, admin_user):
    search = _make_search(db_session, workspace)
    business = _make_business(db_session, search, source_provider="manual", source_external_id=None)

    result = review_intelligence_service.run_review_intelligence(db_session, workspace.id, admin_user.id, business.id)

    assert result.data_status == "no_listing"
    db_session.refresh(business)
    assert business.google_rating is None


def test_service_fetches_and_caches_result_onto_business(db_session, workspace, admin_user, monkeypatch):
    monkeypatch.setattr(settings, "google_places_api_key", "test-key")
    search = _make_search(db_session, workspace)
    business = _make_business(
        db_session, search, source_provider=GooglePlacesDiscoveryProvider.name, source_external_id="places/abc123"
    )

    def fake_get_place_details(place_id):
        assert place_id == "places/abc123"
        return places.PlaceDetails(
            place_id=place_id,
            rating=4.6,
            user_rating_count=120,
            reviews=[places.PlaceReview(rating=5, text="Friendly staff, would recommend", published_at="2026-08-20T00:00:00Z")],
        )

    monkeypatch.setattr(places, "get_place_details", fake_get_place_details)
    monkeypatch.setattr(
        "app.agents.review_intelligence.generate_structured",
        lambda **kwargs: {"summary": "Customers mention friendly staff."},
    )

    result = review_intelligence_service.run_review_intelligence(db_session, workspace.id, admin_user.id, business.id)

    assert result.data_status == "ok"
    assert result.google_rating == 4.6
    assert result.google_review_count == 120
    db_session.refresh(business)
    assert business.google_rating == 4.6
    assert business.google_review_count == 120
    assert business.review_health_score is not None


def test_service_serves_fresh_cached_result_without_refetching(db_session, workspace, admin_user, monkeypatch):
    monkeypatch.setattr(settings, "google_places_api_key", "test-key")
    search = _make_search(db_session, workspace)
    business = _make_business(
        db_session, search, source_provider=GooglePlacesDiscoveryProvider.name, source_external_id="places/abc123"
    )

    calls = {"count": 0}

    def fake_get_place_details(place_id):
        calls["count"] += 1
        return places.PlaceDetails(place_id=place_id, rating=4.2, user_rating_count=30, reviews=[])

    monkeypatch.setattr(places, "get_place_details", fake_get_place_details)
    monkeypatch.setattr("app.agents.review_intelligence.generate_structured", lambda **kwargs: {"summary": "x"})

    review_intelligence_service.run_review_intelligence(db_session, workspace.id, admin_user.id, business.id)
    review_intelligence_service.run_review_intelligence(db_session, workspace.id, admin_user.id, business.id)

    assert calls["count"] == 1


def test_service_serves_stale_good_result_when_google_is_currently_unavailable(db_session, workspace, admin_user, monkeypatch):
    """A transient Google outage must never regress the UI from real,
    slightly-stale data to a blank 'unavailable' state."""
    monkeypatch.setattr(settings, "google_places_api_key", "test-key")
    search = _make_search(db_session, workspace)
    business = _make_business(
        db_session, search, source_provider=GooglePlacesDiscoveryProvider.name, source_external_id="places/abc123"
    )

    monkeypatch.setattr(
        places,
        "get_place_details",
        lambda place_id: places.PlaceDetails(place_id=place_id, rating=4.9, user_rating_count=55, reviews=[]),
    )
    monkeypatch.setattr("app.agents.review_intelligence.generate_structured", lambda **kwargs: {"summary": "x"})
    first = review_intelligence_service.run_review_intelligence(db_session, workspace.id, admin_user.id, business.id)
    assert first.data_status == "ok"

    # Force staleness so the next call actually tries to refetch.
    from app.modules.review_intelligence.models import ReviewIntelligenceResult
    from sqlalchemy import select

    row = db_session.scalar(select(ReviewIntelligenceResult).where(ReviewIntelligenceResult.discovered_business_id == business.id))
    row.review_data_updated_at = datetime.now(timezone.utc) - timedelta(hours=48)
    db_session.commit()

    monkeypatch.setattr(places, "get_place_details", lambda place_id: None)  # Google now unavailable

    second = review_intelligence_service.run_review_intelligence(db_session, workspace.id, admin_user.id, business.id)
    assert second.data_status == "ok"
    assert second.google_rating == 4.9
