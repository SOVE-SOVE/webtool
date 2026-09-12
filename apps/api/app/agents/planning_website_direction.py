"""
Planning's "New Website Plan" mode (docs/05_DECISIONS.md) — for a Lead
with no existing website to audit. This is the one genuinely new agent
that mode needs: it turns everything already verified about the
business (name/category/location/contact, named contacts, Google
review themes, Instagram presence if the lead came through Discovery,
operator notes) into a neutral, evidence-grounded website-planning
brief, the same way agents/planning_review_insights.py turns verified
review themes into recommendations. It is given only already-verified
facts and is instructed never to invent a service, guarantee, price, or
business fact beyond what it's given — anything not covered by the
input must come back as an open question, not a guess. See
agents/prompts/planning_website_direction.md.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.agents.review_intelligence import ThemeOutput
from app.integrations.ai.router import generate_structured
from app.integrations.ai.tasks import AITask

PROMPT_VERSION = "planning_website_direction-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_website_direction.md"


class ContactInput(BaseModel):
    name: str
    role: str | None = None


class PlanningWebsiteDirectionInput(BaseModel):
    business_name: str
    business_category: str | None = None
    location: str | None = None
    phone: str | None = None
    email: str | None = None
    contacts: list[ContactInput] = []
    operator_notes: str | None = None
    positive_review_themes: list[ThemeOutput] = []
    negative_review_themes: list[ThemeOutput] = []
    instagram_handle: str | None = None
    instagram_bio: str | None = None


class PriorityPage(BaseModel):
    title: str
    purpose: str


class PlanningWebsiteDirectionOutput(BaseModel):
    recommended_objective: str
    priority_pages: list[PriorityPage] = []
    content_priorities: list[str] = []
    contact_priorities: list[str] = []
    visual_priorities: list[str] = []
    open_questions: list[str] = []
    website_summary: str


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


def _build_user_message(input: PlanningWebsiteDirectionInput) -> str:
    lines = [
        f"Business name: {input.business_name}",
        f"Business category: {input.business_category or 'not on file'}",
        f"Location: {input.location or 'not on file'}",
        f"Phone: {input.phone or 'not on file'}",
        f"Email: {input.email or 'not on file'}",
    ]
    if input.contacts:
        lines.append(
            "Named contacts: " + ", ".join(f"{c.name}" + (f" ({c.role})" if c.role else "") for c in input.contacts)
        )
    else:
        lines.append("Named contacts: none on file")
    if input.instagram_handle:
        lines.append(f"Instagram: @{input.instagram_handle}" + (f" — bio: \"{input.instagram_bio}\"" if input.instagram_bio else ""))
    else:
        lines.append("Instagram: none on file")
    lines.append(f"Operator notes: {input.operator_notes or 'none'}")
    lines.append(_format_themes("Recurring positive review themes", input.positive_review_themes))
    lines.append(_format_themes("Recurring negative/friction review themes", input.negative_review_themes))
    return "\n".join(lines)


def run(input: PlanningWebsiteDirectionInput) -> AgentResult[PlanningWebsiteDirectionOutput]:
    schema = PlanningWebsiteDirectionOutput.model_json_schema()
    raw = generate_structured(
        task=AITask.PLANNING_WEBSITE_DIRECTION,
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
        max_tokens=1600,
    )
    output = PlanningWebsiteDirectionOutput.model_validate(raw)
    return AgentResult(output=output)
