"""
"Research Comparable Websites" — an optional step inside Planning's New
Website Plan mode (docs/05_DECISIONS.md). Given the same descriptive,
non-screenshot signals agents/planning_audit.py already measures
(PlanningAuditSignals — reused as-is by modules/planning/service.py's
comparable-site fetch step) for a small, operator-curated set of public
comparable sites, this turns them into high-level market patterns and
opportunities for the business's own new website.

This is public reference research only: the input never includes a
screenshot, only structural/technical signals already measured by the
same fetch used for a real audit, and the output schema has no field
for traffic, revenue, ranking, or any other private/unmeasurable claim
— there is nowhere for the model to put one even if asked. The prompt
(agents/prompts/planning_comparable_patterns.md) additionally forbids
quoting or describing specific competitor copy, imagery, or branding —
only paraphrased structural patterns.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.ai.router import generate_structured
from app.integrations.ai.tasks import AITask

PROMPT_VERSION = "planning_comparable_patterns-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_comparable_patterns.md"


class ComparableSiteSignal(BaseModel):
    business_name: str
    website_url: str
    title: str | None = None
    meta_description: str | None = None
    h1_count: int | None = None
    contact_cta_present: bool | None = None
    canonical_present: bool | None = None
    robots_txt_reachable: bool | None = None
    sitemap_xml_reachable: bool | None = None
    mobile_overflow: bool | None = None
    viewport_meta_present: bool | None = None
    load_time_ms: int | None = None
    has_local_business_schema: bool | None = None
    postal_address: str | None = None
    contact_phone: str | None = None


class PlanningComparablePatternsInput(BaseModel):
    business_name: str
    business_category: str | None = None
    sites: list[ComparableSiteSignal] = []


class ComparablePattern(BaseModel):
    pattern: str
    evidence: str


class ComparableOpportunity(BaseModel):
    opportunity: str
    rationale: str


class PlanningComparablePatternsOutput(BaseModel):
    patterns: list[ComparablePattern] = []
    opportunities: list[ComparableOpportunity] = []


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_site(site: ComparableSiteSignal) -> str:
    parts = [f"- {site.business_name} ({site.website_url})"]
    parts.append(f"  Title: {site.title or 'not available'}")
    parts.append(f"  Meta description: {site.meta_description or 'not available'}")
    parts.append(f"  H1 headings on homepage: {site.h1_count if site.h1_count is not None else 'unknown'}")
    parts.append(f"  Contact CTA (phone/email link or form) present: {site.contact_cta_present}")
    parts.append(f"  LocalBusiness structured data present: {site.has_local_business_schema}")
    parts.append(f"  Postal address found on page: {site.postal_address or 'not found'}")
    parts.append(f"  Mobile viewport meta present: {site.viewport_meta_present}; mobile layout overflow: {site.mobile_overflow}")
    parts.append(f"  robots.txt reachable: {site.robots_txt_reachable}; sitemap.xml reachable: {site.sitemap_xml_reachable}")
    parts.append(f"  Measured load time: {site.load_time_ms}ms" if site.load_time_ms is not None else "  Measured load time: unknown")
    return "\n".join(parts)


def _build_user_message(input: PlanningComparablePatternsInput) -> str:
    lines = [
        f"Business being planned for: {input.business_name}",
        f"Category: {input.business_category or 'not on file'}",
        "",
        f"Public reference sites measured ({len(input.sites)}):",
    ]
    lines.extend(_format_site(s) for s in input.sites)
    return "\n".join(lines)


def run(input: PlanningComparablePatternsInput) -> AgentResult[PlanningComparablePatternsOutput]:
    if not input.sites:
        return AgentResult(
            output=PlanningComparablePatternsOutput(),
            confidence=1.0,
            notes="No comparable sites were successfully measured — nothing to synthesize.",
        )

    schema = PlanningComparablePatternsOutput.model_json_schema()
    raw = generate_structured(
        task=AITask.PLANNING_COMPARABLE_PATTERNS,
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
        max_tokens=1200,
    )
    output = PlanningComparablePatternsOutput.model_validate(raw)
    return AgentResult(output=output)
