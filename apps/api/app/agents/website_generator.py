"""
Website generation role — docs/02_ARCHITECTURE.md §6, roadmap M5.
Assembles a website (navigation, footer, and one section list per
sitemap page) from the approved sitemap, using only real content
already collected in the client brief and creative direction — it never
invents copy, testimonials, statistics, images, or business claims.
Where the sitemap or brief call for something this system has no honest
source for yet (team photos, portfolio pieces, pricing, stock imagery
with real alt text), that section is simply not built and the gap is
reported in `missing_information` instead.

Deterministic on purpose, unlike agents/sitemap.py or
agents/creative_director.py: this step only ever copies or lightly
reshapes fields that already exist rather than drafting new prose, so
there is nothing here that benefits from an LLM call and everything to
lose from one (a paraphrase is a new fabrication surface) — see
docs/05_DECISIONS.md.

Output section configs match packages/site-templates' SiteSection shape
exactly (see src/types.ts) — this is what `websites.config` stores and
what a future preview/build step reads. Every generation is also run
through agents/anti_slop.py before being returned, so a caller never
has to remember to check separately.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.agents.anti_slop import AntiSlopInput, AntiSlopOutput, AuthenticContent
from app.agents.anti_slop import PageInput as AntiSlopPageInput
from app.agents.anti_slop import SectionInput as AntiSlopSectionInput
from app.agents.anti_slop import run as run_anti_slop
from app.agents.base import AgentResult

# Mirrors app.modules.sitemaps.models.PageType / NavPlacement by value —
# kept as plain literals, not a DB import, so this agent stays a pure
# input/output contract per docs/02_ARCHITECTURE.md §6 (same convention
# as agents/sitemap.py).
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

# ---------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------


class BriefContent(BaseModel):
    """The subset of DesignBrief fields this agent uses — see
    modules/websites/service.py for how these are pulled from the real
    row. A flat, decoupled input, same convention as SitemapInput."""

    business_description: str | None = None
    services_products: str | None = None
    services_content: str | None = None
    products_content: str | None = None
    about_content: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    location: str | None = None
    testimonials: list[str] = Field(default_factory=list)
    faqs: list[str] = Field(default_factory=list)
    calls_to_action: list[str] = Field(default_factory=list)


class CreativeDirectionContent(BaseModel):
    cta_strategy: str | None = None
    tone_of_voice: str | None = None


class SitemapPageContent(BaseModel):
    id: str
    title: str
    slug: str
    page_type: PageTypeLiteral
    nav_placement: NavPlacementLiteral = "primary_nav"
    primary_cta: str | None = None
    secondary_cta: str | None = None
    key_sections: list[str] = Field(default_factory=list)


class WebsiteGeneratorInput(BaseModel):
    business_name: str
    brief: BriefContent = Field(default_factory=BriefContent)
    creative_direction: CreativeDirectionContent = Field(default_factory=CreativeDirectionContent)
    pages: list[SitemapPageContent]


# ---------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------


class GeneratedSection(BaseModel):
    id: str
    type: str
    config: dict
    approved: bool = False


class GeneratedPage(BaseModel):
    sitemap_page_id: str
    name: str
    slug: str
    page_type: PageTypeLiteral
    sections: list[GeneratedSection]


class WebsiteGeneratorOutput(BaseModel):
    navigation: GeneratedSection
    footer: GeneratedSection
    pages: list[GeneratedPage]
    missing_information: list[str]
    anti_slop: AntiSlopOutput


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------


def _section(type_: str, config: dict) -> GeneratedSection:
    return GeneratedSection(id=str(uuid.uuid4()), type=type_, config=config)


def _find_page_by_type(pages: list[SitemapPageContent], page_type: str) -> SitemapPageContent | None:
    return next((p for p in pages if p.page_type == page_type), None)


def _contact_href(pages: list[SitemapPageContent]) -> str:
    contact = _find_page_by_type(pages, "contact")
    return f"/{contact.slug}" if contact else "#contact"


def _looks_like_list(text: str | None, min_items: int = 2, max_items: int = 8) -> list[str] | None:
    """A block of free text is only treated as a list of discrete items
    when it's actually shaped like one (a handful of short lines) —
    otherwise splitting it would invent structure that isn't there, so
    it's left as prose (a Hero subheading) instead."""
    if not text:
        return None
    lines = [line.strip(" -*\t") for line in text.splitlines() if line.strip()]
    if min_items <= len(lines) <= max_items and all(len(line) <= 120 for line in lines):
        return lines
    return None


def _split_faq_line(line: str) -> tuple[str, str]:
    if "?" in line:
        idx = line.index("?")
        return line[: idx + 1].strip(), line[idx + 1 :].strip()
    return line.strip(), ""


_NO_SOURCE_SECTION_HINTS = {
    "pricing": "pricing",
    "team": "team",
    "portfolio": "portfolio",
    "gallery": "gallery/photos",
    "stats": "stats",
    "logos": "client logos",
}


# ---------------------------------------------------------------------
# Per-page section assembly
# ---------------------------------------------------------------------


def _build_hero(page: SitemapPageContent, brief: BriefContent, business_name: str, contact_href: str) -> GeneratedSection:
    subheading: str | None = None
    if page.page_type == "home":
        heading = business_name
        subheading = brief.business_description
    else:
        heading = page.title
        if page.page_type == "about":
            subheading = brief.about_content
        elif page.page_type == "services" and _looks_like_list(brief.services_content) is None:
            subheading = brief.services_content
        elif page.page_type == "products" and _looks_like_list(brief.products_content) is None:
            subheading = brief.products_content

    config: dict = {"heading": heading}
    if subheading:
        config["subheading"] = subheading
    if page.primary_cta:
        config["primaryCta"] = {"label": page.primary_cta, "href": contact_href}
    if page.secondary_cta:
        config["secondaryCta"] = {"label": page.secondary_cta, "href": contact_href}
    return _section("hero", config)


def _build_page_sections(
    page: SitemapPageContent,
    brief: BriefContent,
    business_name: str,
    contact_href: str,
) -> tuple[list[GeneratedSection], list[str]]:
    sections: list[GeneratedSection] = [_build_hero(page, brief, business_name, contact_href)]
    missing: list[str] = []

    if page.page_type in ("home", "services"):
        items = _looks_like_list(brief.services_content) or _looks_like_list(brief.services_products)
        if items:
            config: dict = {"services": [{"title": item, "description": ""} for item in items]}
            if page.page_type == "home":
                config["heading"] = "What we offer"
            sections.append(_section("serviceCards", config))
        elif page.page_type == "services":
            missing.append(
                f'{page.title}: services content on file isn\'t structured as a clear list of distinct '
                f"services — add them as separate items in the client brief to build a proper services grid."
            )

    if page.page_type in ("home", "products"):
        items = _looks_like_list(brief.products_content)
        if items:
            config = {"services": [{"title": item, "description": ""} for item in items]}
            if page.page_type == "home":
                config["heading"] = "Our products"
            sections.append(_section("serviceCards", config))

    if page.page_type in ("home", "testimonials") and brief.testimonials:
        sections.append(
            _section("testimonials", {"testimonials": [{"quote": q, "authorName": ""} for q in brief.testimonials]})
        )
        missing.append(
            f"{page.title}: {len(brief.testimonials)} testimonial(s) on file with no author name captured — "
            f"attribution left blank rather than invented."
        )

    if page.page_type in ("home", "faq") and brief.faqs:
        items = []
        for line in brief.faqs:
            question, answer = _split_faq_line(line)
            items.append({"question": question, "answer": answer})
            if not answer:
                missing.append(f'{page.title}: FAQ "{question}" has no answer on file yet.')
        sections.append(_section("faq", {"items": items}))

    if page.page_type == "contact":
        details = []
        if brief.contact_email:
            details.append({"label": "Email", "value": brief.contact_email, "href": f"mailto:{brief.contact_email}"})
        if brief.contact_phone:
            details.append({"label": "Phone", "value": brief.contact_phone, "href": f"tel:{brief.contact_phone}"})
        if brief.location:
            details.append({"label": "Location", "value": brief.location})
        if not details:
            missing.append(f"{page.title}: no contact details (email/phone/location) on file yet.")
        form = {
            "fields": [
                {"name": "name", "label": "Name", "type": "text", "required": True},
                {"name": "email", "label": "Email", "type": "email", "required": True},
                {"name": "message", "label": "Message", "type": "textarea", "required": True},
            ],
            "submitLabel": "Send message",
        }
        sections.append(_section("contact", {"details": details, "form": form}))

    if page.page_type == "home" and brief.calls_to_action:
        cta_text = brief.calls_to_action[0]
        sections.append(_section("cta", {"heading": cta_text, "primaryCta": {"label": cta_text, "href": contact_href}}))

    for hint in page.key_sections:
        normalized = hint.lower()
        for keyword, label in _NO_SOURCE_SECTION_HINTS.items():
            if keyword in normalized:
                missing.append(
                    f"{page.title}: sitemap calls for a {label} section, but no real source data exists "
                    f"for it yet — not generated."
                )

    return sections, missing


# ---------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------


def run(input: WebsiteGeneratorInput) -> AgentResult[WebsiteGeneratorOutput]:
    contact_href = _contact_href(input.pages)

    nav_links = [
        {"label": p.title, "href": f"/{p.slug}"}
        for p in input.pages
        if p.nav_placement in ("primary_nav", "primary_and_footer")
    ]
    nav_config: dict = {"logo": {"label": input.business_name, "href": "/"}, "links": nav_links}
    contact_page = _find_page_by_type(input.pages, "contact")
    if contact_page and contact_page.primary_cta:
        nav_config["cta"] = {"label": contact_page.primary_cta, "href": contact_href}
    navigation = _section("navigation", nav_config)

    footer_config: dict = {"copyrightHolder": input.business_name}
    contact_info: dict = {}
    if input.brief.contact_email:
        contact_info["email"] = input.brief.contact_email
    if input.brief.contact_phone:
        contact_info["phone"] = input.brief.contact_phone
    if contact_info:
        footer_config["contact"] = contact_info
    footer_links = [
        {"label": p.title, "href": f"/{p.slug}"}
        for p in input.pages
        if p.nav_placement in ("footer_nav", "primary_and_footer")
    ]
    if footer_links:
        footer_config["columns"] = [{"heading": "Site", "links": footer_links}]
    footer = _section("footer", footer_config)

    pages: list[GeneratedPage] = []
    missing_information: list[str] = []
    anti_slop_pages: list[AntiSlopPageInput] = []

    for sitemap_page in input.pages:
        sections, missing = _build_page_sections(sitemap_page, input.brief, input.business_name, contact_href)
        missing_information.extend(missing)
        pages.append(
            GeneratedPage(
                sitemap_page_id=sitemap_page.id,
                name=sitemap_page.title,
                slug=sitemap_page.slug,
                page_type=sitemap_page.page_type,
                sections=sections,
            )
        )
        anti_slop_pages.append(
            AntiSlopPageInput(
                name=sitemap_page.title,
                sections=[AntiSlopSectionInput(type=s.type, config=s.config) for s in sections],
            )
        )

    anti_slop_result = run_anti_slop(
        AntiSlopInput(
            pages=anti_slop_pages,
            authentic_content=AuthenticContent(known_testimonial_quotes=list(input.brief.testimonials)),
        )
    )

    output = WebsiteGeneratorOutput(
        navigation=navigation,
        footer=footer,
        pages=pages,
        missing_information=missing_information,
        anti_slop=anti_slop_result.output,
    )

    flagged = anti_slop_result.flagged_for_review or len(missing_information) > 0
    return AgentResult(
        output=output,
        confidence=1.0,
        flagged_for_review=flagged,
        notes=None if not flagged else "Missing information and/or quality issues detected — see missing_information / anti_slop.issues.",
    )
