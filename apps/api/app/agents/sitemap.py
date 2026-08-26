"""
Sitemap/planning role — docs/02_ARCHITECTURE.md §6, roadmap M4. Turns a
completed (or partial) client brief plus a creative direction into a
recommended website structure: which pages to build, why each one
exists, what it needs to say and do, and how it sits in navigation. See
agents/prompts/sitemap.md for the actual instructions given to the
model, including the "don't blindly generate every page" requirement.

Does not generate website code — this produces the *plan* the
site-generation system (roadmap M5) will later build from, once the
operator has reviewed/edited/approved it (modules/sitemaps/service.py).
"""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.llm import generate_structured

PROMPT_VERSION = "sitemap-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "sitemap.md"

# Mirrors app.modules.sitemaps.models.PageType / NavPlacement by value.
# Kept as plain literals here (not an import of the DB enum) so this
# agent stays a pure input/output contract with no dependency on a
# module's persistence layer, per docs/02_ARCHITECTURE.md §6.
PageTypeLiteral = Literal[
    "home",
    "about",
    "services",
    "service_detail",
    "products",
    "product_detail",
    "contact",
    "faq",
    "testimonials",
    "portfolio",
    "blog",
    "blog_post",
    "custom",
]
NavPlacementLiteral = Literal["primary_nav", "footer_nav", "primary_and_footer", "not_in_nav"]


class SitemapInput(BaseModel):
    business_name: str
    industry: str | None
    project_name: str
    target_audience: str | None
    business_goals: str | None
    conversion_goal: str | None
    brief_notes: str | None
    creative_direction_notes: str | None
    additional_notes: str | None


class SitemapPageOutput(BaseModel):
    title: str
    slug: str
    page_type: PageTypeLiteral
    # References another page's `slug` in this same output to express
    # nesting (e.g. a service_detail page under the services page).
    # Null means top-level.
    parent_slug: str | None
    nav_placement: NavPlacementLiteral
    purpose: str
    # Null when this page's audience is the same as the sitemap's overall
    # target audience — only set when a *specific* page targets someone
    # narrower (e.g. a commercial-callout service page vs. the site's
    # general residential audience).
    target_audience: str | None
    primary_cta: str
    secondary_cta: str | None
    # The underlying business outcome this page should drive — distinct
    # from primary_cta (the literal button/action text), e.g. "generate
    # qualified same-day emergency callout requests" vs. the CTA text
    # "Call now".
    conversion_goal: str
    seo_intent: str
    key_sections: list[str]
    required_content: list[str]
    required_assets: list[str]
    required_functionality: list[str]


class SitemapOutput(BaseModel):
    overview: str
    pages: list[SitemapPageOutput]


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _build_user_message(input: SitemapInput) -> str:
    return "\n\n".join(
        [
            "BUSINESS / PROJECT",
            f"Business name: {input.business_name}\n"
            f"Industry: {input.industry or 'unknown'}\n"
            f"Project: {input.project_name}",
            "TARGET AUDIENCE / BUSINESS GOALS / CONVERSION GOAL",
            f"Target audience: {input.target_audience or 'not provided'}\n"
            f"Business goals for the new site: {input.business_goals or 'not provided'}\n"
            f"Site-wide primary conversion goal: {input.conversion_goal or 'not provided'}",
            "CLIENT BRIEF (confirmed by the client via intake — treat as fact)",
            input.brief_notes or "No brief on record for this project, or it hasn't been filled in yet.",
            "CREATIVE DIRECTION (the reviewed/approved design direction for this site, if one exists)",
            input.creative_direction_notes or "No creative direction on record for this project yet.",
            "OPERATOR NOTES",
            input.additional_notes or "none",
        ]
    )


def run(input: SitemapInput) -> AgentResult[SitemapOutput]:
    schema = SitemapOutput.model_json_schema()
    raw = generate_structured(
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
    )
    output = SitemapOutput.model_validate(raw)

    # A parent_slug that doesn't match any page in the same output is a
    # malformed generation — flag rather than silently drop the
    # relationship, per docs/03_AGENT_RULES.md.
    slugs = {page.slug for page in output.pages}
    broken_parent_refs = [
        page.slug for page in output.pages if page.parent_slug is not None and page.parent_slug not in slugs
    ]

    no_brief = not input.brief_notes
    no_creative_direction = not input.creative_direction_notes
    thin_evidence = no_brief and not input.target_audience and not input.business_goals

    notes_parts = []
    if broken_parent_refs:
        notes_parts.append(f"Generated pages referenced a parent page that doesn't exist: {', '.join(broken_parent_refs)}.")
    if thin_evidence:
        notes_parts.append("No brief, target audience, or business goals were supplied — this structure rests mostly on industry norms. Review before treating it as final.")
    elif no_brief:
        notes_parts.append("No client brief is on record yet — page content requirements are best-effort, not confirmed by the client.")
    if no_creative_direction:
        notes_parts.append("No creative direction is on record yet — page selection didn't have a reviewed design direction to draw on.")

    flagged = bool(broken_parent_refs) or thin_evidence or no_brief or no_creative_direction
    confidence = 0.35 if (broken_parent_refs or thin_evidence) else (0.6 if (no_brief or no_creative_direction) else 0.85)

    return AgentResult(
        output=output,
        confidence=confidence,
        flagged_for_review=flagged,
        notes=" ".join(notes_parts) if notes_parts else None,
    )
