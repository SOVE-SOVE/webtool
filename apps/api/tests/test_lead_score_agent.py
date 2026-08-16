"""
Unit tests for the lead-scoring engine (app/agents/lead_score.py).
Covers: rule-engine correctness against the real scoring_rules.json,
explainability (every point traces to a reason), confidence behavior
(commercial_value/growth_opportunity never claim high confidence),
warnings (the fabrication disclaimers are always present), and a
structural guard against sensitive personal characteristics ever
entering the input schema.
"""

import pytest

from app.agents.lead_score import (
    _classify_fit,
    _eval_condition,
    _score_category,
    _validate_config,
    run,
)
from app.agents.lead_score_schemas import CATEGORY_KEYS, Confidence, LeadScoreInput
from app.agents.website_audit_schemas import (
    AccessibilityResult,
    ConversionResult,
    DesignResult,
    MobileResult,
    PerformanceResult,
    SeoResult,
    TechnicalResult,
    WebsiteAuditOutput,
)


def _make_audit(**overrides) -> WebsiteAuditOutput:
    defaults = dict(
        url="http://example.com",
        final_url="http://example.com",
        reachable=True,
        technical=TechnicalResult(http_status=200, https=True, broken_resources=[]),
        seo=SeoResult(sitemap_found=True),
        performance=PerformanceResult(heuristic_speed_score=90, resource_counts={"images": 3}),
        mobile=MobileResult(viewport_present=True),
        accessibility=AccessibilityResult(),
        conversion=ConversionResult(),
        design=DesignResult(),
    )
    defaults.update(overrides)
    return WebsiteAuditOutput(**defaults)


# --- Rule engine primitives --------------------------------------------------


def test_eval_condition_operators():
    assert _eval_condition("is_true", True, None) is True
    assert _eval_condition("is_true", False, None) is False
    assert _eval_condition("is_false", False, None) is True
    assert _eval_condition("is_none", None, None) is True
    assert _eval_condition("is_not_none", "x", None) is True
    assert _eval_condition("eq", "a", "a") is True
    assert _eval_condition("gt", 5, 3) is True
    assert _eval_condition("gte", 3, 3) is True
    assert _eval_condition("in", "b", ["a", "b"]) is True
    # An unknown signal value can never satisfy a value-comparison op —
    # this is the "don't guess" behavior for missing data.
    assert _eval_condition("gt", None, 3) is False
    assert _eval_condition("eq", None, "a") is False


def test_score_category_stop_rule_short_circuits():
    rules = [
        {"id": "a", "signal": "x", "op": "is_true", "points": 100, "reason": "A", "stop": True},
        {"id": "b", "signal": "y", "op": "is_true", "points": 50, "reason": "B"},
    ]
    score, reasons = _score_category("cat", rules, {"x": True, "y": True})
    assert score == 100
    assert [r.rule_id for r in reasons] == ["a"]  # b never evaluated


def test_score_category_clamped_to_100():
    rules = [
        {"id": "a", "signal": "x", "op": "is_true", "points": 60, "reason": "A"},
        {"id": "b", "signal": "y", "op": "is_true", "points": 60, "reason": "B"},
    ]
    score, _ = _score_category("cat", rules, {"x": True, "y": True})
    assert score == 100


def test_classify_fit():
    assert _classify_fit("Plumbing Services", ["plumbing"]) == "match"
    assert _classify_fit("Accounting", ["plumbing", "electrical"]) == "no_match"
    assert _classify_fit(None, ["plumbing"]) == "unknown"
    assert _classify_fit("Plumbing", []) == "unconfigured"


def test_validate_config_rejects_bad_weights():
    with pytest.raises(ValueError, match="sum to 100"):
        _validate_config({"category_weights": dict.fromkeys(CATEGORY_KEYS, 10), "categories": {}})


def test_validate_config_rejects_missing_category():
    weights = dict.fromkeys(CATEGORY_KEYS, 100 // len(CATEGORY_KEYS))
    weights[CATEGORY_KEYS[0]] += 100 - sum(weights.values())
    with pytest.raises(ValueError, match="missing rule sets"):
        _validate_config({"category_weights": weights, "categories": {}})


# --- End-to-end scoring (real scoring_rules.json) ----------------------------


def test_empty_lead_flags_no_website_and_missing_data():
    result = run(LeadScoreInput())

    assert result.flagged_for_review is True
    assert result.output.confidence == Confidence.LOW
    website = next(c for c in result.output.categories if c.key == "website_opportunity")
    assert website.score == 100
    assert [r.rule_id for r in website.reasons] == ["no_website"]
    assert any("No website audit found" in w for w in result.output.warnings)


def test_well_documented_lead_scores_highly_but_confidence_capped():
    audit = _make_audit(
        technical=TechnicalResult(http_status=200, https=False, broken_resources=[]),
        conversion=ConversionResult(
            cta_texts_found=["get a quote", "call now"],
            contact_form_present=True,
            contact_links=["mailto:x@y.com"],
        ),
    )
    data = LeadScoreInput(
        industry="Plumbing",
        state="VIC",
        phone="0399998888",
        email="x@y.com",
        social_links="https://facebook.com/x",
        abn="12345678901",
        website_url="http://example.com",
        audit=audit,
    )
    result = run(data)

    assert result.output.overall_score > 70
    # commercial_value and growth_opportunity are structurally capped —
    # even a fully-documented lead can't push overall confidence to HIGH.
    assert result.output.confidence == Confidence.MEDIUM
    commercial = next(c for c in result.output.categories if c.key == "commercial_value")
    growth = next(c for c in result.output.categories if c.key == "growth_opportunity")
    assert commercial.confidence != Confidence.HIGH
    assert growth.confidence != Confidence.HIGH


def test_commercial_value_and_growth_disclaimers_always_present():
    """Regardless of how much data is available, never claim to know revenue/performance."""
    audit = _make_audit()
    rich = run(LeadScoreInput(industry="Plumbing", state="VIC", abn="123", audit=audit))
    empty = run(LeadScoreInput())

    for result in (rich, empty):
        warnings_text = " ".join(result.output.warnings)
        assert "revenue, profit, and customer volume are unknown" in warnings_text
        assert "not verified business performance" in warnings_text


def test_industry_no_match_scores_lower_than_match():
    match = run(LeadScoreInput(industry="Plumbing"))
    no_match = run(LeadScoreInput(industry="Investment Banking"))

    match_fit = next(c for c in match.output.categories if c.key == "business_fit")
    no_match_fit = next(c for c in no_match.output.categories if c.key == "business_fit")
    assert match_fit.score > no_match_fit.score
    assert match_fit.reasons[0].rule_id == "industry_match"
    assert no_match_fit.reasons[0].rule_id == "industry_no_match"


def test_reasons_are_traceable_to_specific_rules():
    """Every point in every category must cite a rule_id and description — that's the explainability contract."""
    result = run(LeadScoreInput(industry="Plumbing", state="VIC", phone="0399998888"))
    for category in result.output.categories:
        for reason in category.reasons:
            assert reason.rule_id
            assert reason.description
            assert isinstance(reason.points, int)


def test_overall_score_is_weighted_sum_of_category_scores():
    result = run(LeadScoreInput(industry="Plumbing"))
    expected = round(sum(c.score * c.weight / 100 for c in result.output.categories))
    assert result.output.overall_score == expected


def test_contactability_reads_from_audit_when_business_fields_blank():
    audit = _make_audit(conversion=ConversionResult(contact_links=["mailto:hello@site.com", "tel:0399998888"]))
    result = run(LeadScoreInput(audit=audit))  # no phone/email on the business record itself

    contactability = next(c for c in result.output.categories if c.key == "contactability")
    reason_ids = {r.rule_id for r in contactability.reasons}
    assert "has_email" in reason_ids


def test_no_sensitive_personal_characteristics_in_input_schema():
    """
    Structural guard: the input schema the engine can see must never grow
    a field for a person's name, age, gender, ethnicity, religion, or
    other personal characteristic. This is the actual enforcement
    mechanism, not just a policy statement — catch it if it regresses.
    """
    forbidden_substrings = [
        "name", "gender", "sex", "age", "race", "ethnic", "religion",
        "disability", "marital", "orientation", "nationality",
    ]
    field_names = set(LeadScoreInput.model_fields.keys())
    for field in field_names:
        for term in forbidden_substrings:
            assert term not in field.lower(), f"Field '{field}' looks like a personal characteristic ({term})"
