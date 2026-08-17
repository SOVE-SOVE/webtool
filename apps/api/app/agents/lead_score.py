"""
Lead-scoring role — docs/02_ARCHITECTURE.md §6, roadmap M2, requirement
#4 ([[01_REQUIREMENTS]]). Deterministic: turns the website audit's real,
measured signals into a 0-100 fit score for the $599-$1,299 redesign
offer. No LLM call — mirrors agents/website_audit.py's approach — so it's
free to run on every audit and never drifts between runs of the same
input.

Higher score = more fixable problems = better-fit lead. A site that
passes every automated check scores low: there's nothing concrete here
to sell, so time is better spent on leads with a real, demonstrable gap.
"""

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.agents.website_audit import WebsiteAuditOutput

NO_SITE_SCORE = 85
BROKEN_SITE_SCORE = 90
EXISTING_SITE_BASELINE = 30
EXISTING_SITE_CAP = 80
SLOW_LOAD_MS = 4000
MODERATE_LOAD_MS = 2000


class LeadScoreInput(BaseModel):
    website_audit: WebsiteAuditOutput


class LeadScoreOutput(BaseModel):
    score: int
    reasons: list[str]


def run(input: LeadScoreInput) -> AgentResult[LeadScoreOutput]:
    audit = input.website_audit

    if not audit.has_existing_site:
        return AgentResult(
            output=LeadScoreOutput(score=NO_SITE_SCORE, reasons=["No existing website on record"]),
            confidence=1.0,
        )

    if audit.audit_error:
        return AgentResult(
            output=LeadScoreOutput(
                score=BROKEN_SITE_SCORE,
                reasons=[f"Existing site could not be loaded: {audit.audit_error}"],
            ),
            confidence=0.6,
            flagged_for_review=True,
            notes="Site failed to load during the audit — score reflects an unreachable/broken "
            "site, but this could also be a transient network issue rather than a real outage.",
        )

    score = EXISTING_SITE_BASELINE
    reasons: list[str] = []

    if audit.https is False:
        score += 15
        reasons.append("Not served over HTTPS")

    if audit.mobile_friendly is False:
        score += 25
        reasons.append("Not mobile-friendly")
    elif audit.mobile_friendly is None and audit.viewport_meta_present is False:
        score += 10
        reasons.append("No mobile viewport tag (mobile-friendliness unconfirmed)")

    if audit.load_time_ms is not None:
        if audit.load_time_ms > SLOW_LOAD_MS:
            score += 20
            reasons.append(f"Slow load time ({audit.load_time_ms} ms)")
        elif audit.load_time_ms > MODERATE_LOAD_MS:
            score += 10
            reasons.append(f"Moderate load time ({audit.load_time_ms} ms)")

    if not audit.meta_description:
        score += 5
        reasons.append("Missing meta description")

    if not audit.title:
        score += 5
        reasons.append("Missing page title")

    score = min(score, EXISTING_SITE_CAP)
    if not reasons:
        reasons.append("Existing site passed every automated check — no clear fit signal found")

    return AgentResult(output=LeadScoreOutput(score=score, reasons=reasons))
