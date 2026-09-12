"""
Planning's "Google Review Insights" synthesis step — the only genuinely
new agent in that feature (docs/05_DECISIONS.md). The Reputation
Snapshot, Customer Themes, and Neutral Review Summary sections are
served straight from modules/review_intelligence (see
agents/review_intelligence.py); this agent only handles the three
sections that require cross-referencing verified review themes against
a Planning workspace's own website-audit findings:

- Website Opportunities: neutral website-planning recommendations,
  each grounded in a specific given review theme.
- FAQ Opportunities: candidate FAQ topics drawn from recurring
  questions/uncertainty/friction in reviews — questions only, never
  answers, always flagged for owner confirmation.
- Review-to-Website Gaps: places where verified review themes and the
  existing website audit disagree or are incomplete.

It is given only already-verified facts (review themes with occurrence
counts and evidence, and the Planning workspace's own audit Findings)
and is instructed never to invent a business fact, service, guarantee,
or claim beyond what it's given — see
agents/prompts/planning_review_insights.md. If there are no themes at
all (too little review data) or no audit findings yet, callers should
not invoke this agent — there being nothing to synthesize is expected,
not a failure.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.agents.planning_audit import Finding
from app.agents.review_intelligence import ThemeOutput
from app.integrations.ai.router import generate_structured
from app.integrations.ai.tasks import AITask

PROMPT_VERSION = "planning_review_insights-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_review_insights.md"


class PlanningReviewInsightsInput(BaseModel):
    business_name: str
    positive_review_themes: list[ThemeOutput] = []
    negative_review_themes: list[ThemeOutput] = []
    audit_findings: list[Finding] = []


class WebsiteOpportunity(BaseModel):
    recommendation: str
    based_on_theme: str


class FaqOpportunity(BaseModel):
    question: str
    based_on_theme: str
    needs_owner_confirmation: bool = True


class ReviewWebsiteGap(BaseModel):
    gap: str
    based_on_theme: str


class PlanningReviewInsightsOutput(BaseModel):
    website_opportunities: list[WebsiteOpportunity] = []
    faq_opportunities: list[FaqOpportunity] = []
    review_website_gaps: list[ReviewWebsiteGap] = []


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_themes(label: str, themes: list[ThemeOutput]) -> str:
    if not themes:
        return f"{label}: none identified"
    lines = [f"{label}:"]
    for t in themes:
        evidence = "; ".join(f'"{e}"' for e in t.evidence) or "no snippets available"
        lines.append(f"- {t.theme} ({t.occurrences} review(s), confidence {t.confidence}) — evidence: {evidence}")
    return "\n".join(lines)


def _format_findings(findings: list[Finding]) -> str:
    if not findings:
        return "Existing website audit findings: none available — do not claim any Review-to-Website Gaps in this case."
    lines = ["Existing website audit findings:"]
    for f in findings:
        lines.append(f"- [{f.area}/{f.category}, {f.severity}] {f.message} (evidence: {f.evidence})")
    return "\n".join(lines)


def _build_user_message(input: PlanningReviewInsightsInput) -> str:
    return "\n\n".join(
        [
            f"Business: {input.business_name}",
            _format_themes("Recurring positive review themes", input.positive_review_themes),
            _format_themes("Recurring negative/friction review themes", input.negative_review_themes),
            _format_findings(input.audit_findings),
        ]
    )


def run(input: PlanningReviewInsightsInput) -> AgentResult[PlanningReviewInsightsOutput]:
    if not input.positive_review_themes and not input.negative_review_themes:
        return AgentResult(
            output=PlanningReviewInsightsOutput(),
            confidence=1.0,
            notes="No recurring review themes available to synthesize from.",
        )

    schema = PlanningReviewInsightsOutput.model_json_schema()
    raw = generate_structured(
        task=AITask.REVIEW_WEBSITE_INSIGHTS,
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
        max_tokens=1200,
    )
    output = PlanningReviewInsightsOutput.model_validate(raw)
    return AgentResult(output=output)
