"""
Website copywriter role — roadmap M4's still-open "Copy drafts generated
from intake + research, for operator sign-off before build" item, and
docs/02_ARCHITECTURE.md §6. Turns the client brief, creative direction,
and approved sitemap into drafted, business-specific copy — headings,
body text, CTAs, service descriptions, FAQ answers, and page SEO
metadata — in a requested tone, for the operator to review/edit/approve
before it ever reaches a generated site. See
agents/prompts/content_generator.md for the actual grounding rules.

Unlike agents/website_generator.py (roadmap M5, deliberately deterministic
— it only ever copies fields that already exist), this agent drafts new
prose, so it carries the same "never fabricate a fact, flag what you
can't honestly draft" discipline as agents/creative_director.py and
agents/sitemap.py. Its output is reviewed/edited/approved
(modules/content_drafts/) before modules/websites/service.py ever reads
it — this agent has no persistence and never talks to the website
generator directly.
"""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.agents.base import AgentResult
from app.integrations.llm import generate_structured

PROMPT_VERSION = "content_generator-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "content_generator.md"

# A small, concrete set of tone controls — kept as plain literals (not a
# DB import) so this agent stays a pure input/output contract, same
# convention as agents/sitemap.py's PageTypeLiteral.
ToneLiteral = Literal["professional", "friendly", "bold", "minimal", "luxury"]

_TONE_DESCRIPTIONS: dict[str, str] = {
    "professional": "Confident, plain-spoken, and credible — the register of a competent trade or service business talking to a customer, not a corporate brochure.",
    "friendly": "Warm and conversational, like a helpful local business owner — approachable, still clear and specific.",
    "bold": "Short, punchy sentences with strong verbs and a direct, energetic delivery — confident without hedging.",
    "minimal": "Spare and understated — as few words as the point needs, no filler, no exclamation points.",
    "luxury": "Measured, precise, and unhurried — restrained language that implies quality through specificity, not superlatives.",
}


# ---------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------


class ContentBriefContent(BaseModel):
    """The subset of DesignBrief fields this agent reads — see
    modules/content_drafts/service.py for how these are pulled from the
    real row. A flat, decoupled input, same convention as
    agents/website_generator.py's BriefContent."""

    business_description: str | None = None
    services_products: str | None = None
    services_content: str | None = None
    products_content: str | None = None
    about_content: str | None = None
    faqs: list[str] = Field(default_factory=list)
    calls_to_action: list[str] = Field(default_factory=list)
    target_customers: str | None = None
    business_goals: str | None = None


class ContentCreativeDirectionContent(BaseModel):
    creative_concept: str | None = None
    tone_of_voice: str | None = None
    brand_personality: list[str] = Field(default_factory=list)
    cta_strategy: str | None = None


class ContentSitemapPage(BaseModel):
    id: str
    title: str
    slug: str
    page_type: str
    purpose: str | None = None
    primary_cta: str | None = None
    secondary_cta: str | None = None
    key_sections: list[str] = Field(default_factory=list)
    required_content: list[str] = Field(default_factory=list)


class ContentGeneratorInput(BaseModel):
    business_name: str
    industry: str | None
    location: str | None
    tone: ToneLiteral
    brief: ContentBriefContent = Field(default_factory=ContentBriefContent)
    creative_direction: ContentCreativeDirectionContent = Field(default_factory=ContentCreativeDirectionContent)
    pages: list[ContentSitemapPage]
    additional_notes: str | None = None


# ---------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------


class DraftedServiceItem(BaseModel):
    title: str
    description: str


class DraftedFaqItem(BaseModel):
    question: str
    answer: str


class PageContentDraft(BaseModel):
    page_id: str
    seo_title: str | None = None
    meta_description: str | None = None
    hero_heading: str | None = None
    hero_subheading: str | None = None
    body: str | None = None
    services: list[DraftedServiceItem] = Field(default_factory=list)
    faqs: list[DraftedFaqItem] = Field(default_factory=list)
    cta_heading: str | None = None
    cta_body: str | None = None


class ContentGeneratorOutput(BaseModel):
    pages: list[PageContentDraft]
    missing_information: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_list(label: str, items: list[str]) -> str:
    if not items:
        return f"{label}: none recorded"
    return f"{label}:\n" + "\n".join(f"- {item}" for item in items)


def _format_page(page: ContentSitemapPage) -> str:
    lines = [
        f"- {page.title} (slug: {page.slug}, type: {page.page_type})",
        f"  Purpose: {page.purpose or 'not specified'}",
        f"  Primary CTA: {page.primary_cta or 'none specified'}",
        f"  Secondary CTA: {page.secondary_cta or 'none specified'}",
    ]
    if page.key_sections:
        lines.append(f"  Key sections called for: {', '.join(page.key_sections)}")
    if page.required_content:
        lines.append(f"  Required content: {', '.join(page.required_content)}")
    lines.append(f"  page_id (echo this back exactly in your output): {page.id}")
    return "\n".join(lines)


def _build_user_message(input: ContentGeneratorInput) -> str:
    return "\n\n".join(
        [
            "BUSINESS RECORD (facts — use directly, do not invent beyond this)",
            f"Name: {input.business_name}\n"
            f"Industry: {input.industry or 'unknown'}\n"
            f"Location: {input.location or 'unknown'}",
            "REQUESTED TONE",
            f"{input.tone} — {_TONE_DESCRIPTIONS[input.tone]}",
            "CLIENT INTAKE BRIEF (confirmed by the client — treat as fact)",
            f"Business description: {input.brief.business_description or 'none on record'}\n"
            f"Services/products: {input.brief.services_products or 'none on record'}\n"
            f"Services detail: {input.brief.services_content or 'none on record'}\n"
            f"Products detail: {input.brief.products_content or 'none on record'}\n"
            f"About content: {input.brief.about_content or 'none on record'}\n"
            f"Target customers: {input.brief.target_customers or 'none on record'}\n"
            f"Business goals: {input.brief.business_goals or 'none on record'}\n"
            + _format_list("FAQ questions/answers on file", input.brief.faqs)
            + "\n"
            + _format_list("Calls to action on file", input.brief.calls_to_action),
            "CREATIVE DIRECTION (reviewed design direction for this site, if one exists)",
            f"Creative concept: {input.creative_direction.creative_concept or 'none on record'}\n"
            f"Tone of voice guidance: {input.creative_direction.tone_of_voice or 'none on record'}\n"
            f"CTA strategy: {input.creative_direction.cta_strategy or 'none on record'}\n"
            + _format_list("Brand personality", input.creative_direction.brand_personality),
            "APPROVED SITEMAP PAGES (draft content for exactly these pages, keyed by page_id)",
            "\n".join(_format_page(p) for p in input.pages) if input.pages else "No sitemap pages supplied.",
            "OPERATOR NOTES",
            input.additional_notes or "none",
        ]
    )


# ---------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------


def run(input: ContentGeneratorInput) -> AgentResult[ContentGeneratorOutput]:
    schema = ContentGeneratorOutput.model_json_schema()
    raw = generate_structured(
        system=_load_system_prompt(),
        user=_build_user_message(input),
        schema=schema,
    )
    output = ContentGeneratorOutput.model_validate(raw)

    # A page_id that doesn't match any page we asked about is a malformed
    # generation — flag rather than silently keep or drop it, per
    # docs/03_AGENT_RULES.md (same convention as agents/sitemap.py's
    # broken_parent_refs check).
    valid_ids = {p.id for p in input.pages}
    unknown_pages = [p.page_id for p in output.pages if p.page_id not in valid_ids]

    has_thin_brief = not any(
        [
            input.brief.business_description,
            input.brief.services_products,
            input.brief.services_content,
            input.brief.products_content,
            input.brief.about_content,
        ]
    )

    notes_parts = []
    if unknown_pages:
        notes_parts.append(f"Generated content referenced page(s) not in the sitemap: {', '.join(unknown_pages)}.")
    if has_thin_brief:
        notes_parts.append(
            "The client brief has almost no business/services/about content on file yet — drafted copy is "
            "necessarily thin and generic. Fill in the brief and regenerate for stronger copy."
        )
    if output.missing_information:
        notes_parts.append(f"{len(output.missing_information)} gap(s) reported — see missing_information.")

    flagged = bool(unknown_pages) or has_thin_brief or bool(output.missing_information)
    confidence = 0.3 if (unknown_pages or has_thin_brief) else (0.7 if output.missing_information else 0.9)

    return AgentResult(
        output=output,
        confidence=confidence,
        flagged_for_review=flagged,
        notes=" ".join(notes_parts) if notes_parts else None,
    )
