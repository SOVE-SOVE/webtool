"""
Website Brief generator — roadmap M4. Rolls up everything already known
and already decided about a project (client intake brief, reviewed
creative direction, reviewed sitemap, wherever any of those exist) into
one client-facing document: project summary, goals, audience,
positioning, sitemap, page purposes, content requirements, CTA strategy,
visual direction, functionality, SEO considerations, and technical
requirements. See agents/prompts/website_brief.md for the full
instructions, including which sections are always AI judgement
(positioning, SEO, technical requirements) versus reflect real upstream
data (target audience, CTA strategy, visual direction, sitemap/page
content) when it exists.

`target_audience`/`business_goals`/`brief_notes`/`creative_direction_notes`/
`sitemap_notes` are resolved by the service layer
(modules/website_briefs/service.py) from the project's `DesignBrief`,
latest/approved `CreativeDirectionBrief`, and latest/approved `Sitemap`.
The service layer also overrides this agent's draft for fields that
already have a real, reviewed source (target audience, CTA strategy,
visual direction, sitemap/page content) rather than letting a fresh LLM
guess replace already-decided work — see docs/05_DECISIONS.md. This
agent's own output is used as-is only where no such source exists yet
(project_summary, goals, positioning, seo_considerations,
technical_requirements always; the rest as a fallback).
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.llm import generate_structured

PROMPT_VERSION = "website_brief-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "website_brief.md"


class WebsiteBriefInput(BaseModel):
    business_name: str
    industry: str | None
    project_name: str
    target_audience: str | None
    business_goals: str | None
    brief_notes: str | None
    creative_direction_notes: str | None
    sitemap_notes: str | None
    additional_notes: str | None


class WebsiteBriefOutput(BaseModel):
    project_summary: str
    goals: list[str]
    target_audience: str
    positioning: str
    sitemap_summary: list[str]
    page_purposes: list[str]
    content_requirements: list[str]
    cta_strategy: str
    visual_direction: str
    functionality: list[str]
    seo_considerations: list[str]
    technical_requirements: list[str]


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _build_user_message(input: WebsiteBriefInput) -> str:
    return "\n\n".join(
        [
            "BUSINESS / PROJECT",
            f"Business name: {input.business_name}\nIndustry: {input.industry or 'unknown'}\nProject: {input.project_name}",
            "TARGET AUDIENCE / BUSINESS GOALS (resolved from creative direction or intake brief, or "
            "operator-entered at generation time — 'not provided' means none of those has it)",
            f"Target audience: {input.target_audience or 'not provided'}\n"
            f"Business goals for the new site: {input.business_goals or 'not provided'}",
            "CLIENT INTAKE BRIEF (confirmed by the client via intake — treat as fact, not assumption)",
            input.brief_notes or "No intake brief on record for this project, or it hasn't been filled in yet.",
            "CREATIVE DIRECTION (the reviewed/approved design direction for this site, if one exists)",
            input.creative_direction_notes or "No creative direction on record for this project yet.",
            "SITEMAP (the reviewed/approved page structure for this site, if one exists)",
            input.sitemap_notes or "No sitemap on record for this project yet.",
            "OPERATOR NOTES",
            input.additional_notes or "none",
        ]
    )


def run(input: WebsiteBriefInput) -> AgentResult[WebsiteBriefOutput]:
    schema = WebsiteBriefOutput.model_json_schema()
    raw = generate_structured(
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
    )
    output = WebsiteBriefOutput.model_validate(raw)

    no_brief = not input.brief_notes
    no_creative_direction = not input.creative_direction_notes
    no_sitemap = not input.sitemap_notes
    thin_evidence = no_brief and not input.target_audience and not input.business_goals

    notes_parts = []
    if thin_evidence:
        notes_parts.append(
            "No intake brief, target audience, or business goals were supplied — this brief rests mostly on "
            "industry norms. Review every section before treating it as final."
        )
    elif no_brief:
        notes_parts.append("No client intake brief is on record yet — content requirements are best-effort, not confirmed by the client.")
    if no_creative_direction:
        notes_parts.append("No creative direction is on record yet — visual direction/CTA strategy are first-draft suggestions, not a reviewed decision.")
    if no_sitemap:
        notes_parts.append("No sitemap is on record yet — the sitemap/page purposes below are a proposal, not an approved structure.")

    flagged = thin_evidence or no_brief or no_creative_direction or no_sitemap
    confidence = 0.35 if thin_evidence else (0.55 if (no_creative_direction or no_sitemap) else 0.8)

    return AgentResult(
        output=output,
        confidence=confidence,
        flagged_for_review=flagged,
        notes=" ".join(notes_parts) if notes_parts else None,
    )
