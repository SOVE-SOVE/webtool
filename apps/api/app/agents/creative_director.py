"""
Creative director role — docs/02_ARCHITECTURE.md §6, roadmap M4. Turns
everything known about a client/project (business record, website
audit, prior sales research, client intake brief) plus whatever the
operator has supplied about target audience/goals into a structured
creative direction for a website designer or the site-generation system
to work from. See agents/prompts/creative_director.md for the actual
instructions given to the model, including the FACTS/RECOMMENDATIONS/
ASSUMPTIONS framework required by the Creative Director feature.

`target_audience`/`business_goals`/`intake_notes` are resolved by the
service layer (modules/creative_directions/service.py) from the
project's `DesignBrief` (client intake, modules/design_briefs/) when one
exists, with any operator-supplied override at generation time taking
priority. A project with no intake brief yet — or one still missing
those fields — falls back to whatever the operator typed in, and a
genuine gap in both sources is flagged rather than silently producing a
generic direction.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.agents.website_audit import WebsiteAuditOutput
from app.integrations.llm import generate_structured, parse_structured_output

PROMPT_VERSION = "creative_director-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "creative_director.md"


class CreativeDirectorInput(BaseModel):
    business_name: str
    industry: str | None
    suburb: str | None
    state: str | None
    website_url: str | None
    social_links: str | None
    business_notes: str | None
    project_name: str
    project_stage: str
    website_audit: WebsiteAuditOutput | None
    prior_research_summary: str | None
    prior_website_strengths: list[str] | None
    prior_top_problems: list[str] | None
    prior_suggested_structure: list[str] | None
    prior_suggested_offer: str | None
    target_audience: str | None
    business_goals: str | None
    additional_notes: str | None
    intake_notes: str | None


class CreativeDirectorOutput(BaseModel):
    facts: list[str]
    assumptions: list[str]
    creative_concept: str
    visual_direction: str
    brand_personality: list[str]
    colour_direction: str
    typography_direction: str
    image_direction: str
    layout_direction: str
    ux_direction: str
    tone_of_voice: str
    visual_hierarchy: str
    cta_strategy: str
    things_to_avoid: list[str]
    references_inspiration: list[str]


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_website_audit(audit: WebsiteAuditOutput | None) -> str:
    if audit is None:
        return "No website audit was run (no website URL on record)."
    if not audit.has_existing_site:
        return "This business has no existing website on record — there is no existing brand/visual system to preserve or react against."
    if audit.audit_error:
        return f"The current website could not be loaded during audit. Error: {audit.audit_error}"
    lines = [
        f"HTTPS: {audit.https}",
        f"Page title: {audit.title!r}",
        f"Meta description: {audit.meta_description!r}",
        f"Mobile-friendly (rendered check): {audit.mobile_friendly}",
        f"Measured page load time: {audit.load_time_ms} ms" if audit.load_time_ms is not None else "Page load time: not measured",
    ]
    return "\n".join(lines)


def _format_list(label: str, items: list[str] | None) -> str:
    if not items:
        return f"{label}: none recorded"
    return f"{label}:\n" + "\n".join(f"- {item}" for item in items)


def _build_user_message(input: CreativeDirectorInput) -> str:
    return "\n\n".join(
        [
            "BUSINESS RECORD (facts — use directly, do not invent beyond this)",
            f"Name: {input.business_name}\n"
            f"Industry: {input.industry or 'unknown'}\n"
            f"Location: {input.suburb or '?'}, {input.state or '?'}\n"
            f"Website URL on record: {input.website_url or 'none'}\n"
            f"Social links: {input.social_links or 'none'}\n"
            f"Business notes: {input.business_notes or 'none'}",
            "PROJECT",
            f"Project name: {input.project_name}\nPipeline stage: {input.project_stage}",
            "EXISTING BRAND / WEBSITE AUDIT (real, measured — treat as ground truth for what it covers)",
            _format_website_audit(input.website_audit),
            "PRIOR SALES RESEARCH (already gathered during the sales process, real evidence)",
            f"Business summary: {input.prior_research_summary or 'none on record'}\n"
            + _format_list("Website strengths found", input.prior_website_strengths)
            + "\n"
            + _format_list("Top problems found", input.prior_top_problems)
            + "\n"
            + _format_list("Suggested site structure", input.prior_suggested_structure)
            + f"\nSuggested offer/tier: {input.prior_suggested_offer or 'none on record'}",
            "CLIENT INTAKE BRIEF (confirmed by the client, via the intake form — treat as fact, not assumption)",
            input.intake_notes or "No intake brief on record for this project, or it hasn't been filled in yet.",
            "TARGET AUDIENCE / BUSINESS GOALS (resolved from the intake brief above, or operator-entered at "
            "generation time if the brief doesn't have them — 'not provided' means neither source has it, and "
            "you do not know it: treat any statement about it as an assumption, not a fact)",
            f"Target audience: {input.target_audience or 'not provided'}\n"
            f"Business goals for the new site: {input.business_goals or 'not provided'}\n"
            f"Additional notes: {input.additional_notes or 'none'}",
        ]
    )


def run(input: CreativeDirectorInput) -> AgentResult[CreativeDirectorOutput]:
    schema = CreativeDirectorOutput.model_json_schema()
    raw = generate_structured(
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
    )
    output = parse_structured_output(CreativeDirectorOutput, raw)

    # The two inputs that matter most for a *client-specific* (not
    # generic) direction are target audience and business goals — client
    # intake isn't built yet, so these are commonly missing today. Flag
    # rather than let a heavily-assumption-based direction pass through
    # silently, per docs/03_AGENT_RULES.md.
    missing_core_context = not input.target_audience and not input.business_goals
    website_unusable = (
        input.website_audit is None
        or not input.website_audit.has_existing_site
        or bool(input.website_audit.audit_error)
    )
    thin_evidence = missing_core_context and website_unusable and not input.prior_research_summary

    notes = None
    if missing_core_context:
        notes = "No target audience or business goals were supplied — most of this direction rests on assumptions inferred from industry/audit data alone. Review the assumptions list before treating this as final."
    elif thin_evidence:
        notes = "Limited evidence available — best effort from the business record alone."

    return AgentResult(
        output=output,
        confidence=0.4 if thin_evidence else (0.6 if missing_core_context else 0.85),
        flagged_for_review=missing_core_context or thin_evidence,
        notes=notes,
    )
