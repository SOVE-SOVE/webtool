"""
Planning's "Content Draft" (docs/05_DECISIONS.md) — turns the Build
Brief's already-verified inputs (business facts, accepted Keep/Improve/
Add, review themes, social presence, the selected visual direction and
its tone) into real page copy: headline/subheading, service
descriptions, About body, a gallery intro, contact/booking details, CTA
labels, confirmed FAQs, and an SEO title/meta description — one page at
a time, run from modules/planning/service.py's job handler.

`section_type` values match packages/site-templates/src/registry.ts's
own type strings exactly ("hero", "about", "serviceCards", "gallery",
"contact", "cta", "faq") and each `content` dict matches that type's
real config shape — the same loosely-typed-JSON convention
agents/anti_slop.py's own SectionInput.config already uses, so an
approved section reaches the real generator with zero translation.
Never invents a service, price, hour, staff name, award, guarantee, or
testimonial; a review excerpt is never turned into a testimonial unless
explicitly marked already-approved-for-that-use in the input; an
unanswered FAQ topic goes in `needs_confirmation`, never a made-up
answer. Only drafts sections that actually fit the page — never forced
to fill all 7 types. See agents/prompts/planning_content_draft.md,
which also mirrors agents/anti_slop.py's own banned-phrase vocabulary
so a draft is far less likely to fail that deterministic gate later.
"""

from pathlib import Path

from pydantic import BaseModel, Field

from app.agents.base import AgentResult
from app.integrations.ai.router import generate_structured
from app.integrations.ai.tasks import AITask

PROMPT_VERSION = "planning_content_draft-v1"
_PROMPT_PATH = Path(__file__).parent / "prompts" / "planning_content_draft.md"

SECTION_TYPES = ["hero", "about", "serviceCards", "gallery", "contact", "cta", "faq"]


class ContactInput(BaseModel):
    name: str
    role: str | None = None


class ApprovedTestimonialInput(BaseModel):
    """A review/testimonial excerpt the operator has explicitly approved
    for use as a testimonial — never derived automatically from Google
    Review Insights themes. Empty unless the operator has done this."""

    quote: str
    author_name: str | None = None


class PlanningContentDraftPageInput(BaseModel):
    business_name: str
    business_category: str | None = None
    location: str | None = None
    phone: str | None = None
    email: str | None = None
    contacts: list[ContactInput] = []
    operator_notes: str | None = None
    website_objective: str | None = None
    accepted_keep: list[str] = []
    accepted_improve: list[str] = []
    accepted_add: list[str] = []
    positive_review_themes: list[str] = []
    negative_review_themes: list[str] = []
    approved_testimonials: list[ApprovedTestimonialInput] = []
    instagram_bio: str | None = None
    facebook_bio: str | None = None
    visual_character: str | None = None
    visual_tone_notes: str | None = None
    comparable_patterns: list[str] = []
    # The target page itself.
    page_title: str
    page_type: str
    page_purpose: str
    page_reason: str
    page_key_sections: list[str] = []
    page_needs_confirmation: bool = False


class ContentSectionDraft(BaseModel):
    section_type: str
    content: dict = Field(default_factory=dict)
    needs_confirmation: list[str] = []


class PlanningContentDraftPageOutput(BaseModel):
    seo_title: str | None = None
    seo_meta_description: str | None = None
    sections: list[ContentSectionDraft] = []


class PlanningContentSectionInput(PlanningContentDraftPageInput):
    target_section_type: str


def _load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _format_themes(label: str, themes: list[str]) -> str:
    if not themes:
        return f"{label}: none identified"
    return f"{label}:\n" + "\n".join(f"- {t}" for t in themes)


def _build_shared_context(input: PlanningContentDraftPageInput) -> list[str]:
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
    lines.append(f"Website objective: {input.website_objective or 'not generated yet'}")
    if input.accepted_keep:
        lines.append("Accepted 'Keep' items:\n" + "\n".join(f"- {i}" for i in input.accepted_keep))
    if input.accepted_improve:
        lines.append("Accepted 'Improve' items:\n" + "\n".join(f"- {i}" for i in input.accepted_improve))
    if input.accepted_add:
        lines.append("Accepted 'Add' items:\n" + "\n".join(f"- {i}" for i in input.accepted_add))
    lines.append(_format_themes("Recurring positive review themes", input.positive_review_themes))
    lines.append(_format_themes("Recurring negative/friction review themes", input.negative_review_themes))
    if input.approved_testimonials:
        lines.append(
            "Testimonials the operator has explicitly approved for use (quote them verbatim, exactly as given, "
            "only in a testimonials-appropriate context):\n"
            + "\n".join(f'- "{t.quote}"' + (f" — {t.author_name}" if t.author_name else "") for t in input.approved_testimonials)
        )
    else:
        lines.append("Approved testimonials: none — do not create a testimonials section.")
    if input.instagram_bio:
        lines.append(f'Instagram bio: "{input.instagram_bio}"')
    if input.facebook_bio:
        lines.append(f'Facebook about text: "{input.facebook_bio}"')
    if input.visual_character:
        lines.append(f"Visual/brand character: {input.visual_character}")
    if input.visual_tone_notes:
        lines.append(f"Tone notes: {input.visual_tone_notes}")
    if input.comparable_patterns:
        lines.append(
            "High-level patterns from public comparable-site research (informative only, never a copy source):\n"
            + "\n".join(f"- {p}" for p in input.comparable_patterns)
        )
    lines.append(f"Operator notes: {input.operator_notes or 'none'}")
    return lines


def _build_page_message(input: PlanningContentDraftPageInput) -> str:
    lines = _build_shared_context(input)
    lines.append("---")
    lines.append(f"Page to draft: {input.page_title}")
    lines.append(f"Page type: {input.page_type}")
    lines.append(f"Page purpose: {input.page_purpose}")
    lines.append(f"Why this page was proposed: {input.page_reason}")
    if input.page_key_sections:
        lines.append("Suggested section hints for this page: " + ", ".join(input.page_key_sections))
    if input.page_needs_confirmation:
        lines.append("This page's content was flagged as depending on services/copy not yet confirmed.")
    return "\n".join(lines)


def run_page(input: PlanningContentDraftPageInput) -> AgentResult[PlanningContentDraftPageOutput]:
    schema = PlanningContentDraftPageOutput.model_json_schema()
    raw = generate_structured(
        task=AITask.PLANNING_CONTENT_DRAFT,
        system=_load_system_prompt(),
        user=_build_page_message(input),
        schema=schema,
        max_tokens=2400,
    )
    output = PlanningContentDraftPageOutput.model_validate(raw)
    return AgentResult(output=output)


def run_section(input: PlanningContentSectionInput) -> AgentResult[ContentSectionDraft]:
    lines = _build_page_message(input)
    lines += f"\n---\nRegenerate ONLY the '{input.target_section_type}' section for this page, using the same facts as above."
    schema = ContentSectionDraft.model_json_schema()
    raw = generate_structured(
        task=AITask.PLANNING_CONTENT_DRAFT,
        system=_load_system_prompt(),
        user=lines,
        schema=schema,
        max_tokens=1000,
    )
    output = ContentSectionDraft.model_validate(raw)
    return AgentResult(output=output)
