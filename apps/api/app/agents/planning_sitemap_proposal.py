"""
Planning's Build Brief (docs/05_DECISIONS.md) — "Proposed Sitemap and
Homepage Outline". Mode-agnostic: runs for an Existing-Website workspace
(informed by its own audit findings/objective) and a New-Website-Plan
workspace (informed by business/social/review facts) alike.

`page_type` is constrained to modules/sitemaps.models.PageType's exact
member values so a proposed page is already in the vocabulary the real
Sitemap module uses — at Create Project, a proposed page becomes a real
SitemapPage row with zero translation. `key_sections` is the same
free-text-hint shape agents/sitemap.py's SitemapPageOutput already
produces, for the same reason.

Given only already-verified facts; proportional to the business (no
filler pages), and explicit about which proposed pages depend on
content not actually confirmed anywhere in the input. See
agents/prompts/planning_sitemap_proposal.md.
"""

from pathlib import Path

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.ai.router import generate_structured
from app.integrations.ai.tasks import AITask
from app.modules.sitemaps.models import PageType

PROMPT_VERSION = "planning_sitemap_proposal-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_sitemap_proposal.md"

_PAGE_TYPES = [t.value for t in PageType]


class PlanningSitemapProposalInput(BaseModel):
    business_name: str
    business_category: str | None = None
    website_objective: str | None = None
    accepted_add_items: list[str] = []
    has_existing_website: bool = False
    audit_area_summary: list[str] = []
    has_social_presence: bool = False
    has_positive_reviews: bool = False


class ProposedPage(BaseModel):
    title: str
    page_type: str
    purpose: str
    reason: str
    key_sections: list[str] = []
    needs_confirmation: bool = False


class PlanningSitemapProposalOutput(BaseModel):
    pages: list[ProposedPage] = []


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8").replace("{{PAGE_TYPES}}", ", ".join(_PAGE_TYPES))


def _build_user_message(input: PlanningSitemapProposalInput) -> str:
    lines = [
        f"Business name: {input.business_name}",
        f"Business category: {input.business_category or 'not on file'}",
        f"Website objective: {input.website_objective or 'not generated yet'}",
        f"Has an existing website: {'yes' if input.has_existing_website else 'no — building the first one'}",
    ]
    if input.accepted_add_items:
        lines.append("Accepted 'Add' recommendations:\n" + "\n".join(f"- {i}" for i in input.accepted_add_items))
    else:
        lines.append("Accepted 'Add' recommendations: none yet")
    if input.audit_area_summary:
        lines.append("Audit areas needing attention:\n" + "\n".join(f"- {a}" for a in input.audit_area_summary))
    lines.append(f"Has a confirmed social presence (Instagram or Facebook): {'yes' if input.has_social_presence else 'no'}")
    lines.append(f"Has positive Google review themes on file: {'yes' if input.has_positive_reviews else 'no'}")
    return "\n".join(lines)


def run(input: PlanningSitemapProposalInput) -> AgentResult[PlanningSitemapProposalOutput]:
    schema = PlanningSitemapProposalOutput.model_json_schema()
    raw = generate_structured(
        task=AITask.PLANNING_SITEMAP_PROPOSAL,
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
        max_tokens=1800,
    )
    output = PlanningSitemapProposalOutput.model_validate(raw)
    # Defense in depth: never let a page_type outside the real enum reach
    # the database — fall back to CUSTOM rather than failing the whole
    # generation over one bad label.
    valid = set(_PAGE_TYPES)
    for page in output.pages:
        if page.page_type not in valid:
            page.page_type = PageType.CUSTOM.value
    return AgentResult(output=output)
