"""
Planning's Build Brief (docs/05_DECISIONS.md) — Keep / Improve / Add.
Mode-agnostic, unlike agents/planning_website_direction.py: it runs for
both an Existing-Website workspace (grounded in real audit findings) and
a New-Website-Plan workspace (grounded in business/social/review facts
only, since there is no site to find fault with). It also produces
`website_objective`, the Build Brief's own objective statement — kept
separate from LeadPlanning.recommended_objective (New-Website-Plan-mode
only) so that field's existing behavior is untouched.

Given only already-verified facts; never invents a service, price, or
business fact. The one Existing-Website-specific hard rule: an `improve`
item must cite a real audit finding or a real negative review theme —
when a workspace has neither (a New-Website-Plan workspace, or an
Existing-Website one with no findings), `improve` is simply empty rather
than inventing a plausible-sounding problem. See
agents/prompts/planning_recommendations.md.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.agents.planning_audit import Finding
from app.agents.review_intelligence import ThemeOutput
from app.integrations.ai.router import generate_structured
from app.integrations.ai.tasks import AITask

PROMPT_VERSION = "planning_recommendations-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_recommendations.md"


class ContactInput(BaseModel):
    name: str
    role: str | None = None


class PlanningRecommendationsInput(BaseModel):
    business_name: str
    business_category: str | None = None
    location: str | None = None
    phone: str | None = None
    email: str | None = None
    contacts: list[ContactInput] = []
    operator_notes: str | None = None
    has_existing_website: bool = False
    website_summary: str | None = None
    audit_findings: list[Finding] = []
    positive_review_themes: list[ThemeOutput] = []
    negative_review_themes: list[ThemeOutput] = []
    instagram_handle: str | None = None
    instagram_bio: str | None = None
    has_instagram_profile_image: bool = False
    facebook_page_url: str | None = None
    facebook_bio: str | None = None
    comparable_patterns: list[str] = []
    comparable_opportunities: list[str] = []


class RecommendationItem(BaseModel):
    title: str
    explanation: str
    source_type: str
    source_evidence: str | None = None


class PlanningRecommendationsOutput(BaseModel):
    website_objective: str
    keep: list[RecommendationItem] = []
    improve: list[RecommendationItem] = []
    add: list[RecommendationItem] = []


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_findings(findings: list[Finding]) -> str:
    if not findings:
        return "Audit findings: none on file"
    lines = ["Audit findings:"]
    for f in findings:
        lines.append(f"- [{f.area}/{f.category}, {f.severity}] {f.message} — evidence: {f.evidence}")
    return "\n".join(lines)


def _format_themes(label: str, themes: list[ThemeOutput]) -> str:
    if not themes:
        return f"{label}: none identified"
    lines = [f"{label}:"]
    for t in themes:
        evidence = "; ".join(f'"{e}"' for e in t.evidence) or "no snippets available"
        lines.append(f"- {t.theme} ({t.occurrences} review(s), confidence {t.confidence}) — evidence: {evidence}")
    return "\n".join(lines)


def _build_user_message(input: PlanningRecommendationsInput) -> str:
    lines = [
        f"Business name: {input.business_name}",
        f"Business category: {input.business_category or 'not on file'}",
        f"Location: {input.location or 'not on file'}",
        f"Phone: {input.phone or 'not on file'}",
        f"Email: {input.email or 'not on file'}",
        f"Has an existing website: {'yes' if input.has_existing_website else 'no — building the first one'}",
    ]
    if input.contacts:
        lines.append(
            "Named contacts: " + ", ".join(f"{c.name}" + (f" ({c.role})" if c.role else "") for c in input.contacts)
        )
    else:
        lines.append("Named contacts: none on file")
    if input.website_summary:
        lines.append(f"Current website summary: {input.website_summary}")
    lines.append(_format_findings(input.audit_findings))
    if input.instagram_handle:
        parts = [f"Instagram: @{input.instagram_handle}"]
        if input.instagram_bio:
            parts.append(f'bio: "{input.instagram_bio}"')
        lines.append(" — ".join(parts))
        if input.has_instagram_profile_image:
            lines.append("A profile image is on file for this Instagram account — reference only.")
    else:
        lines.append("Instagram: none on file")
    if input.facebook_page_url:
        parts = [f"Facebook Page: {input.facebook_page_url}"]
        if input.facebook_bio:
            parts.append(f'about: "{input.facebook_bio}"')
        lines.append(" — ".join(parts))
    else:
        lines.append("Facebook: none on file")
    lines.append(f"Operator notes: {input.operator_notes or 'none'}")
    lines.append(_format_themes("Recurring positive review themes", input.positive_review_themes))
    lines.append(_format_themes("Recurring negative/friction review themes", input.negative_review_themes))
    if input.comparable_patterns:
        lines.append("Market patterns from public comparable-site research:\n" + "\n".join(f"- {p}" for p in input.comparable_patterns))
    if input.comparable_opportunities:
        lines.append(
            "Opportunities from public comparable-site research:\n"
            + "\n".join(f"- {o}" for o in input.comparable_opportunities)
        )
    return "\n".join(lines)


def run(input: PlanningRecommendationsInput) -> AgentResult[PlanningRecommendationsOutput]:
    schema = PlanningRecommendationsOutput.model_json_schema()
    raw = generate_structured(
        task=AITask.PLANNING_RECOMMENDATIONS,
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
        max_tokens=2000,
    )
    output = PlanningRecommendationsOutput.model_validate(raw)
    return AgentResult(output=output)
