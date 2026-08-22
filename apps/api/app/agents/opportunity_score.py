"""
Lead opportunity scoring — docs/04_ROADMAP.md Lead Intelligence stage 4.
Deterministic, no LLM call, same "more fixable problems = better-fit
lead" philosophy as agents/lead_score.py (which scores an existing CRM
Lead from its website audit; this scores a pre-CRM DiscoveredBusiness
from its research). Every point on the score traces to a named entry in
`factors` — there is no adjustment this module makes that isn't also
recorded there, per the "operator must understand WHY a business scored
highly" requirement. HOT/WARM/COLD reflect the score; REVIEW is a
separate axis — a score built from too little confirmed evidence is
flagged for a human to check rather than trusted outright, regardless
of what the number says.

"Industry suitability" (docs/04_ROADMAP.md's signal list) is
deliberately not a scored factor here: this app has no real, defensible
data on which industries convert better as redesign clients, and
inventing a weighting would be exactly the kind of unsupported claim
Lead Intelligence is built to avoid. The industry is still shown to the
operator (DiscoveredBusinessRead.industry) — just not silently baked
into the number.
"""

from typing import Literal

from pydantic import BaseModel

from app.agents.base import AgentResult

Category = Literal["hot", "warm", "cold", "review"]
Direction = Literal["positive", "negative"]

BASELINE = 30
NO_WEBSITE_SCORE = 85
UNREACHABLE_WEBSITE_SCORE = 90
REACHABLE_SITE_CAP = 80
SLOW_LOAD_MS = 4000
MODERATE_LOAD_MS = 2000

HOT_THRESHOLD = 70
WARM_THRESHOLD = 45
REVIEW_CONFIDENCE_THRESHOLD = 0.6
_SUMMARY_PREVIEW_COUNT = 3


class ScoreFactor(BaseModel):
    factor: str
    points: int
    direction: Direction
    explanation: str


class OpportunityScoreInput(BaseModel):
    has_website_on_record: bool
    website_reachable: bool | None = None
    research_error: str | None = None
    https: bool | None = None
    mobile_viewport_present: bool | None = None
    load_time_ms: int | None = None
    contact_cta_present: bool | None = None
    appears_template_or_placeholder: bool | None = None
    page_title: str | None = None
    meta_description: str | None = None
    social_presence_count: int = 0
    # Fraction (0-1) of the core research signals above that were
    # actually measured rather than unknown — the "evidence quality"
    # signal from the Lead Intelligence spec. Computed by the service
    # layer from the research row, not by this agent, so this module
    # stays a pure function of already-summarized inputs.
    evidence_completeness: float = 1.0


class OpportunityScoreOutput(BaseModel):
    overall_score: int
    category: Category
    confidence: float
    positive_signals: list[str]
    negative_signals: list[str]
    factors: list[ScoreFactor]
    recommendation_reason: str


def _category(score: int, confidence: float) -> Category:
    if confidence < REVIEW_CONFIDENCE_THRESHOLD:
        return "review"
    if score >= HOT_THRESHOLD:
        return "hot"
    if score >= WARM_THRESHOLD:
        return "warm"
    return "cold"


def _no_website_result(input: OpportunityScoreInput) -> OpportunityScoreOutput:
    factor = ScoreFactor(
        factor="no_website",
        points=NO_WEBSITE_SCORE - BASELINE,
        direction="positive",
        explanation="No website found on record — a clear, easy-to-explain redesign opportunity.",
    )
    return OpportunityScoreOutput(
        overall_score=NO_WEBSITE_SCORE,
        category=_category(NO_WEBSITE_SCORE, 1.0),
        confidence=1.0,
        positive_signals=["No existing website found"],
        negative_signals=[],
        factors=[factor],
        recommendation_reason="No website on record — as clear an opportunity as this pipeline can identify.",
    )


def _unreachable_website_result(input: OpportunityScoreInput) -> OpportunityScoreOutput:
    factor = ScoreFactor(
        factor="site_unreachable",
        points=UNREACHABLE_WEBSITE_SCORE - BASELINE,
        direction="positive",
        explanation=f"The existing website could not be loaded during research ({input.research_error or 'no response'}).",
    )
    return OpportunityScoreOutput(
        overall_score=UNREACHABLE_WEBSITE_SCORE,
        category=_category(UNREACHABLE_WEBSITE_SCORE, 0.9),
        confidence=0.9,
        positive_signals=[],
        negative_signals=["Existing website appears to be down or broken"],
        factors=[factor],
        recommendation_reason=(
            "The business has a website on record, but it did not load during research — a broken or "
            "inaccessible site is a strong, concrete opportunity, though worth a quick manual recheck first "
            "in case it was a transient outage."
        ),
    )


def _reachable_website_result(input: OpportunityScoreInput) -> OpportunityScoreOutput:
    score = BASELINE
    factors: list[ScoreFactor] = []
    positive: list[str] = []
    negative: list[str] = []

    def add(factor: str, points: int, explanation: str) -> None:
        nonlocal score
        score += points
        factors.append(ScoreFactor(factor=factor, points=points, direction="positive", explanation=explanation))

    if input.https is False:
        add("no_https", 15, "Site is not served over HTTPS.")
        negative.append("Not served over HTTPS")
    elif input.https is True:
        positive.append("Served over HTTPS")

    if input.mobile_viewport_present is False:
        add("no_mobile_viewport", 20, "No mobile viewport tag — the site likely isn't mobile-friendly.")
        negative.append("No mobile viewport tag")
    elif input.mobile_viewport_present is True:
        positive.append("Has a mobile viewport tag")

    if input.load_time_ms is not None:
        if input.load_time_ms > SLOW_LOAD_MS:
            add("slow_load_time", 15, f"Measured load time of {input.load_time_ms}ms is slow.")
            negative.append(f"Slow load time ({input.load_time_ms}ms)")
        elif input.load_time_ms > MODERATE_LOAD_MS:
            add("moderate_load_time", 8, f"Measured load time of {input.load_time_ms}ms is moderate.")
            negative.append(f"Moderate load time ({input.load_time_ms}ms)")
        else:
            positive.append(f"Fast load time ({input.load_time_ms}ms)")

    if input.contact_cta_present is False:
        add("no_contact_path", 20, "No mailto/tel link or contact form found on the page.")
        negative.append("No clear contact path found")
    elif input.contact_cta_present is True:
        positive.append("Has a clear contact path")

    if input.appears_template_or_placeholder:
        add("placeholder_content", 10, "Placeholder/unfinished content is still visible on the live page.")
        negative.append("Placeholder content found on the live page")

    if not input.page_title:
        add("missing_title", 5, "Page has no title.")
        negative.append("Missing page title")

    if not input.meta_description:
        add("missing_meta_description", 5, "Page has no meta description.")
        negative.append("Missing meta description")

    if input.social_presence_count == 0:
        add("no_social_presence", 5, "No social media links were found on the page.")
        negative.append("No social media presence found on the page")
    else:
        positive.append(f"{input.social_presence_count} social media link(s) found")

    score = min(score, REACHABLE_SITE_CAP)
    confidence = round(0.5 + 0.5 * input.evidence_completeness, 2)

    if not factors:
        positive.append("Existing site passed every automated check available")
        reason = "The existing site passed every check this pipeline can run — no concrete, evidence-backed problem to lead a pitch with."
    else:
        named = [f.factor.replace("_", " ") for f in factors[:_SUMMARY_PREVIEW_COUNT]]
        suffix = "…" if len(factors) > _SUMMARY_PREVIEW_COUNT else ""
        reason = f"{len(factors)} concrete issue(s) found on the existing site — {', '.join(named)}{suffix}."

    return OpportunityScoreOutput(
        overall_score=score,
        category=_category(score, confidence),
        confidence=confidence,
        positive_signals=positive,
        negative_signals=negative,
        factors=factors,
        recommendation_reason=reason,
    )


def run(input: OpportunityScoreInput) -> AgentResult[OpportunityScoreOutput]:
    if not input.has_website_on_record:
        output = _no_website_result(input)
        return AgentResult(output=output, confidence=output.confidence)

    if input.website_reachable is False:
        output = _unreachable_website_result(input)
        return AgentResult(
            output=output,
            confidence=output.confidence,
            flagged_for_review=True,
            notes="Website was unreachable during research — recommend a quick manual recheck before outreach.",
        )

    output = _reachable_website_result(input)
    flagged = output.category == "review"
    return AgentResult(
        output=output,
        confidence=output.confidence,
        flagged_for_review=flagged,
        notes="Score built from limited evidence — recommend a manual look before relying on it." if flagged else None,
    )
