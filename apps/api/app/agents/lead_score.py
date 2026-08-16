"""
Lead scoring engine — stage 4 (LEAD SCORE) of the pipeline in
docs/00_VISION.md. Answers one question: is this business a promising
prospect for our web-design service? Scores six categories (see
docs/00_VISION.md / the operator's brief) from data already on file —
the business record and the most recent website audit, if one exists.

**The scoring policy lives in scoring_rules.json, not in this file** —
category weights, target industries/regions, and every point-scoring
rule are data, not code, so the rubric can be retuned without touching
this module. See docs/05_DECISIONS.md.

**No sensitive personal characteristics.** `LeadScoreInput` below is the
complete set of fields this engine can ever see — it structurally has
no field for a person's name, age, gender, ethnicity, or any other
personal characteristic. Every signal is a business-level fact (industry,
location, registration, contact channels, website technical/content
findings).

**No fabrication.** Every signal is either a directly observed fact
(from the business record or a website audit that actually ran) or an
explicitly-labeled inference from those facts — never a guessed number.
`commercial_value` and `growth_opportunity` in particular carry a
standing disclaimer (see `_build_warnings`) since revenue, profit,
customer volume, and real growth trend are never known here.
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.agents.base import AgentResult
from app.agents.lead_score_schemas import (
    CATEGORY_KEYS,
    CATEGORY_LABELS,
    CategoryScore,
    Confidence,
    LeadScoreInput,
    LeadScoreOutput,
    ScoreReason,
    weakest_confidence,
)

CONFIG_PATH = Path(__file__).parent / "scoring_rules.json"


@lru_cache(maxsize=1)
def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    _validate_config(config)
    return config


def _validate_config(config: dict) -> None:
    weights = config.get("category_weights", {})
    missing = set(CATEGORY_KEYS) - set(weights)
    if missing:
        raise ValueError(f"scoring_rules.json is missing weights for: {sorted(missing)}")
    if sum(weights.values()) != 100:
        raise ValueError(f"category_weights must sum to 100, got {sum(weights.values())}")
    missing_categories = set(CATEGORY_KEYS) - set(config.get("categories", {}))
    if missing_categories:
        raise ValueError(f"scoring_rules.json is missing rule sets for: {sorted(missing_categories)}")


_OPS = {
    "eq": lambda v, e: v == e,
    "ne": lambda v, e: v != e,
    "lt": lambda v, e: v < e,
    "lte": lambda v, e: v <= e,
    "gt": lambda v, e: v > e,
    "gte": lambda v, e: v >= e,
    "in": lambda v, e: v in e,
    "not_in": lambda v, e: v not in e,
}


def _eval_condition(op: str, signal_value: Any, expected: Any) -> bool:
    if op == "is_true":
        return signal_value is True
    if op == "is_false":
        return signal_value is False
    if op == "is_none":
        return signal_value is None
    if op == "is_not_none":
        return signal_value is not None
    if signal_value is None:
        return False  # an unknown value can't satisfy a value comparison
    if op not in _OPS:
        raise ValueError(f"Unknown rule operator: {op}")
    return _OPS[op](signal_value, expected)


def _score_category(category_key: str, rules: list[dict], signals: dict[str, Any]) -> tuple[int, list[ScoreReason]]:
    total = 0
    reasons: list[ScoreReason] = []
    for rule in rules:
        signal_value = signals.get(rule["signal"])
        if _eval_condition(rule["op"], signal_value, rule.get("value")):
            total += rule["points"]
            reasons.append(ScoreReason(rule_id=rule["id"], description=rule["reason"], points=rule["points"]))
            if rule.get("stop"):
                break
    return max(0, min(100, total)), reasons


# --- Signal extraction -------------------------------------------------------


def _classify_fit(value: str | None, target_list: list[str]) -> str:
    """Returns "unconfigured" / "unknown" / "match" / "no_match"."""
    if not target_list:
        return "unconfigured"
    if not value:
        return "unknown"
    normalized = value.strip().lower()
    for target in target_list:
        if target.lower() in normalized or normalized in target.lower():
            return "match"
    return "no_match"


def _social_link_count(social_links: str | None) -> int:
    if not social_links:
        return 0
    return len([line for line in re.split(r"[\n,]", social_links) if line.strip()])


def _extract_signals(data: LeadScoreInput, config: dict) -> dict[str, Any]:
    audit = data.audit
    audit_available = audit is not None and audit.reachable

    signals: dict[str, Any] = {
        "audit_available": audit_available,
        "target_industries_configured": bool(config.get("target_industries")),
        "target_states_configured": bool(config.get("target_states")),
        "industry_fit": _classify_fit(data.industry, config.get("target_industries", [])),
        "location_fit": _classify_fit(data.state, config.get("target_states", [])),
        "has_phone": bool(data.phone) or bool(audit and audit.conversion.phone_numbers_found),
        "has_email": bool(data.email) or bool(audit and audit.conversion.contact_links and any(
            link.startswith("mailto:") for link in audit.conversion.contact_links
        )),
        "has_social_links": bool(data.social_links),
        "has_abn": bool(data.abn),
        "has_existing_site": bool(audit_available) or bool(data.website_url and not audit),
    }
    social_count = _social_link_count(data.social_links)
    signals["contact_channel_count"] = sum(
        [bool(data.phone), bool(data.email), social_count > 0]
    )

    if audit_available and audit is not None:
        seo_issues = len([f for f in audit.findings if f.category.value == "seo"])
        accessibility_issues = len([f for f in audit.findings if f.category.value == "accessibility"])
        signals.update(
            {
                "https": audit.technical.https,
                "mobile_viewport_present": audit.mobile.viewport_present,
                "broken_resource_count": len(audit.technical.broken_resources),
                "heuristic_speed_score": audit.performance.heuristic_speed_score,
                "seo_issue_count": seo_issues,
                "accessibility_issue_count": accessibility_issues,
                "design_outdated_signal_count": len(audit.design.outdated_signals),
                "has_contact_form": audit.conversion.contact_form_present,
                "cta_found_count": len(audit.conversion.cta_texts_found),
                "sitemap_found": audit.seo.sitemap_found,
                "resource_count_total": sum(audit.performance.resource_counts.values()),
            }
        )
    else:
        # No audit to draw on — these stay None ("unknown"), never guessed.
        signals.update(
            {
                "https": None,
                "mobile_viewport_present": None,
                "broken_resource_count": 0,
                "heuristic_speed_score": None,
                "seo_issue_count": 0,
                "accessibility_issue_count": 0,
                "design_outdated_signal_count": 0,
                "has_contact_form": None,
                "cta_found_count": 0,
                "sitemap_found": None,
                "resource_count_total": 0,
            }
        )

    return signals


# --- Confidence ---------------------------------------------------------


def _confidence_for(category_key: str, signals: dict[str, Any]) -> Confidence:
    if category_key == "website_opportunity":
        return Confidence.HIGH if signals["audit_available"] else Confidence.LOW
    if category_key == "business_fit":
        if not signals["target_industries_configured"]:
            return Confidence.LOW
        return Confidence.HIGH if signals["industry_fit"] != "unknown" else Confidence.LOW
    if category_key == "local_relevance":
        if not signals["target_states_configured"]:
            return Confidence.LOW
        return Confidence.HIGH if signals["location_fit"] != "unknown" else Confidence.LOW
    if category_key == "contactability":
        return Confidence.HIGH
    if category_key == "commercial_value":
        # Structurally inferential regardless of how much data we have —
        # never claim HIGH confidence on a category that's a proxy for a
        # number (revenue/budget) we never actually observe.
        return Confidence.MEDIUM if (signals["industry_fit"] == "match" or signals["has_abn"]) else Confidence.LOW
    if category_key == "growth_opportunity":
        return Confidence.MEDIUM if signals["audit_available"] else Confidence.LOW
    return Confidence.LOW


# --- Warnings ----------------------------------------------------------


def _build_warnings(signals: dict[str, Any]) -> list[str]:
    warnings = []
    if not signals["audit_available"]:
        warnings.append(
            "No website audit found for this lead — technical/content signals from the "
            "site itself are unavailable. Run a website audit for a more complete score."
        )
    if signals["industry_fit"] == "unknown":
        warnings.append("Industry not recorded on this business — business/service fit could not be confirmed.")
    if not signals["target_industries_configured"]:
        warnings.append(
            "No target industries configured in the scoring rules — business/service fit defaulted to neutral."
        )
    if signals["location_fit"] == "unknown":
        warnings.append("No location recorded on this business — local relevance could not be confirmed.")
    if not signals["target_states_configured"]:
        warnings.append(
            "No target regions configured in the scoring rules — local relevance defaulted to neutral."
        )
    warnings.append(
        "Commercial value is inferred from industry, registration, and presence signals only — "
        "actual revenue, profit, and customer volume are unknown and not estimated."
    )
    warnings.append(
        "Growth opportunity is inferred from visible website/marketing signals only — "
        "not verified business performance, revenue trend, or hiring data."
    )
    if signals.get("_audit_flagged"):
        warnings.append(
            "The underlying website audit was flagged for review — treat website-opportunity "
            "findings with extra caution."
        )
    return warnings


# --- Entry point ---------------------------------------------------------


def run(data: LeadScoreInput) -> AgentResult[LeadScoreOutput]:
    config = _load_config()
    signals = _extract_signals(data, config)
    signals["_audit_flagged"] = data.audit_flagged_for_review

    categories: list[CategoryScore] = []
    overall = 0
    for key in CATEGORY_KEYS:
        rules = config["categories"][key]["rules"]
        score, reasons = _score_category(key, rules, signals)
        weight = config["category_weights"][key]
        confidence = _confidence_for(key, signals)
        categories.append(
            CategoryScore(
                key=key,
                label=CATEGORY_LABELS[key],
                score=score,
                weight=weight,
                confidence=confidence,
                reasons=reasons,
            )
        )
        overall += score * weight / 100

    overall_confidence = weakest_confidence([c.confidence for c in categories])
    warnings = _build_warnings(signals)

    output = LeadScoreOutput(
        overall_score=round(overall),
        confidence=overall_confidence,
        categories=categories,
        warnings=warnings,
        config_version=config["version"],
    )

    flagged = overall_confidence == Confidence.LOW or not signals["audit_available"]
    return AgentResult(
        output=output,
        flagged_for_review=flagged,
        notes="Low confidence — see warnings" if flagged else None,
    )
