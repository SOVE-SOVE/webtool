"""
Anti-Slop quality evaluation — docs/00_VISION.md's "AI slop is
unacceptable... output quality is a hard constraint", docs/01_REQUIREMENTS.md's
"Quality floor", docs/03_AGENT_RULES.md's quality bar. Deterministic:
explicit rule checks over a proposed website's section configs, not an
LLM judgment call — mirrors agents/lead_score.py's approach so a score
never drifts between runs of the same input.

Operates on raw JSON section configs (`dict`), the same shape
`packages/site-templates`' SiteSection config takes and the same shape
`websites.config` (a JSON column) actually stores — there's no Python
duplicate of the TypeScript types, just the small `requiredFields` map
below kept in sync with `packages/site-templates/src/registry.ts` by
hand (see REQUIRED_FIELDS).

Two concerns are kept deliberately separate, per the "must never
fabricate... missing information should be clearly identified"
requirement:
  - `issues`: real problems with content/structure/style that IS there.
  - `missing_information`: required content that ISN'T there. Never
    scored as a quality defect — an honest gap is not slop.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field

from app.agents.base import AgentResult

# ---------------------------------------------------------------------
# Input model
# ---------------------------------------------------------------------


class SectionInput(BaseModel):
    type: str
    config: dict = Field(default_factory=dict)


class PageInput(BaseModel):
    name: str
    sections: list[SectionInput] = Field(default_factory=list)


class VisualStyleInput(BaseModel):
    """Design/theme signals the generator made, not derived from the
    section configs themselves (packages/site-templates has no such
    knobs yet — see docs/05_DECISIONS.md). Every field defaults to the
    safest value, so omitting this entirely never produces a false
    positive; only an explicit, reported heavy-handed choice does."""

    gradient_usage: Literal["none", "accent", "heavy"] = "none"
    glassmorphism: bool = False
    border_radius: Literal["none", "subtle", "moderate", "heavy"] = "subtle"
    animation_intensity: Literal["none", "subtle", "heavy"] = "none"
    # Purely-decorative shapes/icons/illustrations with no navigational
    # or informational function — reported by the generator, not inferred.
    decorative_element_count: int = 0


class AuthenticContent(BaseModel):
    """The real, sourced content the generator was given — the ground
    truth every testimonial/stat/claim in the output is checked
    against. An empty pool doesn't mean nothing is true, it means this
    evaluator has nothing to confirm authenticity against, so anything
    in that category gets flagged rather than trusted by default."""

    known_testimonial_quotes: list[str] = Field(default_factory=list)
    known_stat_values: list[str] = Field(default_factory=list)
    known_claims: list[str] = Field(default_factory=list)


class AntiSlopInput(BaseModel):
    pages: list[PageInput]
    visual_style: VisualStyleInput = Field(default_factory=VisualStyleInput)
    authentic_content: AuthenticContent = Field(default_factory=AuthenticContent)


# ---------------------------------------------------------------------
# Output model
# ---------------------------------------------------------------------

Severity = Literal["high", "medium", "low"]

_SEVERITY_PENALTY: dict[Severity, int] = {"high": 15, "medium": 7, "low": 3}


class QualityIssue(BaseModel):
    category: str
    rule: str
    severity: Severity
    message: str
    location: str | None = None


class AntiSlopOutput(BaseModel):
    score: int
    passed: bool
    issues: list[QualityIssue]
    missing_information: list[str]


# ---------------------------------------------------------------------
# Content extraction helpers — operate on raw config dicts so this
# never has to duplicate packages/site-templates' TypeScript schema.
# ---------------------------------------------------------------------

# Field names treated as free-form prose to run copy checks against.
# Deliberately excludes things like cta.label, form field labels, and
# nav link text, which are short/structurally repeated by design.
_PROSE_FIELDS = {"heading", "subheading", "body", "quote", "description", "tagline", "answer"}

# Section types built from repeated card-shaped items — used by the
# "excessive cards" / "generic layout" structural checks.
_CARD_GRID_SECTION_TYPES = {"serviceCards", "features", "team", "portfolio"}

_STOCK_IMAGE_HOSTS = {
    "unsplash.com",
    "images.unsplash.com",
    "pexels.com",
    "images.pexels.com",
    "pixabay.com",
    "shutterstock.com",
    "istockphoto.com",
    "gettyimages.com",
    "freepik.com",
    "stock.adobe.com",
}

_GENERIC_ALT_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"^stock photo",
        r"^placeholder",
        r"^image$",
        r"^photo$",
        r"^(smiling |happy )?business (team|people)( photo)?$",
        r"^(business )?handshake( photo)?$",
        r"^generic (office|team) photo$",
    ]
]

# Kept to the field names each section registers as required, per
# packages/site-templates/src/registry.ts — update both together.
REQUIRED_FIELDS: dict[str, list[str]] = {
    "navigation": ["logo", "links"],
    "hero": ["heading"],
    "cta": ["heading", "primaryCta"],
    "serviceCards": ["services"],
    "features": ["features"],
    "testimonials": ["testimonials"],
    "pricing": ["tiers"],
    "faq": ["items"],
    "contact": ["details"],
    "imageContentSplit": ["heading", "body", "media"],
    "gallery": ["images"],
    "footer": ["copyrightHolder"],
    "form": ["form"],
    "stats": ["stats"],
    "logos": ["logos"],
    "team": ["members"],
    "portfolio": ["projects"],
}


def _is_empty(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return len(value.strip()) == 0
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def _iter_media(node: object) -> list[dict]:
    """Recursively finds every {src, alt}-shaped dict in a config."""
    found: list[dict] = []
    if isinstance(node, dict):
        if "src" in node and "alt" in node:
            found.append(node)
        for value in node.values():
            found.extend(_iter_media(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_iter_media(item))
    return found


def _iter_prose(node: object, key: str | None = None) -> list[str]:
    """Recursively collects string values under prose-ish keys."""
    found: list[str] = []
    if isinstance(node, dict):
        for k, value in node.items():
            if isinstance(value, str) and k in _PROSE_FIELDS and value.strip():
                found.append(value.strip())
            else:
                found.extend(_iter_prose(value, k))
    elif isinstance(node, list):
        for item in node:
            found.extend(_iter_prose(item, key))
    return found


# ---------------------------------------------------------------------
# Slop phrase / claim heuristics
# ---------------------------------------------------------------------

_GENERIC_OPENERS = [
    "welcome to our website",
    "welcome to our site",
]

_MARKETING_CLICHES = [
    "we are passionate about",
    "we pride ourselves on",
    "your one-stop shop",
    "take your business to the next level",
    "in today's fast-paced world",
    "in today's digital age",
    "look no further",
    "unparalleled quality",
    "unparalleled service",
    "unparalleled expertise",
    "cutting-edge",
    "state-of-the-art",
    "seamless experience",
    "committed to excellence",
    "customer satisfaction is our top priority",
    "we go above and beyond",
    "unmatched expertise",
    "industry-leading",
    "world-class",
    "dedicated team of experts",
    "exceeding expectations",
    "tailored solutions",
    "solutions tailored to your needs",
    "elevate your",
    "empower your",
    "unlock your potential",
    "game-changing",
    "game changer",
    "revolutionize",
    "delve into",
    "robust solutions",
    "comprehensive solutions",
]

# Absolute/superlative claims that need a source, not just an assertion.
_UNVERIFIED_CLAIM_PATTERNS = [
    re.compile(r"\bthe best\b", re.IGNORECASE),
    re.compile(r"#\s?1\b", re.IGNORECASE),
    re.compile(r"\bleading provider\b", re.IGNORECASE),
    re.compile(r"\bonly company that\b", re.IGNORECASE),
    re.compile(r"\bguaranteed\b", re.IGNORECASE),
    re.compile(r"\baward-winning\b", re.IGNORECASE),
    re.compile(r"\bmarket leader\b", re.IGNORECASE),
]

# Numeric/superlative claims shaped like a statistic, found in free
# prose rather than a dedicated `stats` section — softer signal than a
# declared stat, so this is medium severity ("review this number")
# rather than an outright fabrication accusation.
_INLINE_STAT_PATTERN = re.compile(
    r"\b(over|more than)\s+[\d,]+|\b[\d,]+\+?\s*(customers|clients|projects|years|jobs)\b",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _stat_value_in_pool(value: str, pool: list[str]) -> bool:
    """Stat values are short tokens by nature ("12+", "24/7") — unlike
    _fuzzy_in_pool's length-ratio guard (needed so a short accidental
    substring can't validate an entire fabricated testimonial), a plain
    substring check is the right amount of leniency here."""
    normalized = _normalize(value)
    if not normalized:
        return True
    return any(normalized in _normalize(known) or _normalize(known) in normalized for known in pool if known.strip())


def _fuzzy_in_pool(text: str, pool: list[str]) -> bool:
    normalized = _normalize(text)
    if not normalized:
        return True
    for known in pool:
        known_norm = _normalize(known)
        if not known_norm:
            continue
        if normalized == known_norm:
            return True
        shorter, longer = sorted([normalized, known_norm], key=len)
        if shorter and shorter in longer and len(shorter) / len(longer) >= 0.6:
            return True
    return False


# ---------------------------------------------------------------------
# Rule checks
# ---------------------------------------------------------------------


def _check_missing_information(page: PageInput) -> list[str]:
    missing: list[str] = []
    for section in page.sections:
        for field in REQUIRED_FIELDS.get(section.type, []):
            if _is_empty(section.config.get(field)):
                missing.append(f'{page.name} > {section.type}: missing required field "{field}"')
    return missing


def _check_generic_copy(page: PageInput) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    for section in page.sections:
        for text in _iter_prose(section.config):
            normalized = _normalize(text)
            for phrase in _GENERIC_OPENERS:
                if phrase in normalized:
                    issues.append(
                        QualityIssue(
                            category="generic_copy",
                            rule="generic_welcome_language",
                            severity="high",
                            message=f'Generic opening line detected: "{text}"',
                            location=f"{page.name} > {section.type}",
                        )
                    )
            for phrase in _MARKETING_CLICHES:
                if phrase in normalized:
                    issues.append(
                        QualityIssue(
                            category="generic_copy",
                            rule="marketing_cliche",
                            severity="medium",
                            message=f'Marketing cliche detected ("{phrase}") in: "{text}"',
                            location=f"{page.name} > {section.type}",
                        )
                    )
    return issues


def _check_repetitive_phrasing(pages: list[PageInput]) -> list[QualityIssue]:
    seen: Counter[str] = Counter()
    locations: dict[str, str] = {}
    for page in pages:
        for section in page.sections:
            for text in _iter_prose(section.config):
                normalized = _normalize(text)
                if len(normalized) < 8:
                    continue
                seen[normalized] += 1
                locations.setdefault(normalized, f"{page.name} > {section.type}")

    issues: list[QualityIssue] = []
    for normalized, count in seen.items():
        if count > 1:
            issues.append(
                QualityIssue(
                    category="repetitive_phrasing",
                    rule="duplicate_copy",
                    severity="medium",
                    message=f'The same line appears {count} times across the site: "{normalized}"',
                    location=locations[normalized],
                )
            )
    return issues


def _check_unverified_claims(page: PageInput, authentic: AuthenticContent) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    for section in page.sections:
        for text in _iter_prose(section.config):
            for pattern in _UNVERIFIED_CLAIM_PATTERNS:
                if pattern.search(text) and not _fuzzy_in_pool(text, authentic.known_claims):
                    issues.append(
                        QualityIssue(
                            category="fabricated_content",
                            rule="unverified_claim",
                            severity="high",
                            message=f'Unverified superlative/absolute claim: "{text}" — no matching source in known claims.',
                            location=f"{page.name} > {section.type}",
                        )
                    )
            if _INLINE_STAT_PATTERN.search(text) and not _fuzzy_in_pool(text, authentic.known_stat_values):
                issues.append(
                    QualityIssue(
                        category="fabricated_content",
                        rule="unverified_inline_statistic",
                        severity="medium",
                        message=f'Number-shaped claim not traceable to a known figure: "{text}"',
                        location=f"{page.name} > {section.type}",
                    )
                )
    return issues


def _check_testimonials(page: PageInput, authentic: AuthenticContent) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    for section in page.sections:
        if section.type != "testimonials":
            continue
        for testimonial in section.config.get("testimonials", []):
            quote = str(testimonial.get("quote", ""))
            if not quote:
                continue
            if not _fuzzy_in_pool(quote, authentic.known_testimonial_quotes):
                issues.append(
                    QualityIssue(
                        category="fabricated_content",
                        rule="unverified_testimonial",
                        severity="high",
                        message=f'Testimonial has no matching source in the authentic content pool: "{quote}"',
                        location=f"{page.name} > testimonials",
                    )
                )
    return issues


def _check_stats(page: PageInput, authentic: AuthenticContent) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    for section in page.sections:
        if section.type != "stats":
            continue
        for stat in section.config.get("stats", []):
            value = str(stat.get("value", ""))
            label = str(stat.get("label", ""))
            if not value:
                continue
            if not _stat_value_in_pool(value, authentic.known_stat_values):
                issues.append(
                    QualityIssue(
                        category="fabricated_content",
                        rule="unverified_statistic",
                        severity="high",
                        message=f'Statistic "{value} — {label}" has no matching source in known figures.',
                        location=f"{page.name} > stats",
                    )
                )
    return issues


def _check_stock_imagery(page: PageInput) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    for section in page.sections:
        for media in _iter_media(section.config):
            src = str(media.get("src", ""))
            alt = str(media.get("alt", ""))
            host = urlparse(src).netloc.lower()
            if host and any(host == h or host.endswith(f".{h}") for h in _STOCK_IMAGE_HOSTS):
                issues.append(
                    QualityIssue(
                        category="generic_imagery",
                        rule="stock_photo_host",
                        severity="medium",
                        message=f"Image sourced from a generic stock photo host ({host}) rather than real client photography.",
                        location=f"{page.name} > {section.type}",
                    )
                )
            if any(pattern.match(alt.strip()) for pattern in _GENERIC_ALT_PATTERNS):
                issues.append(
                    QualityIssue(
                        category="generic_imagery",
                        rule="generic_alt_text",
                        severity="low",
                        message=f'Alt text reads as a generic placeholder rather than a real description: "{alt}"',
                        location=f"{page.name} > {section.type}",
                    )
                )
    return issues


def _check_structure(page: PageInput) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    types = [s.type for s in page.sections]
    content_types = [t for t in types if t not in ("navigation", "footer")]

    # Same section type stacked back-to-back.
    for previous, current in zip(content_types, content_types[1:]):
        if previous == current:
            issues.append(
                QualityIssue(
                    category="structure",
                    rule="repeated_adjacent_section",
                    severity="medium",
                    message=f'Two "{current}" sections appear back-to-back on {page.name} — merge or vary them.',
                    location=page.name,
                )
            )

    # Excessive cards: too many card-shaped sections, or too many total
    # card items, stacked on one page.
    card_sections = [s for s in page.sections if s.type in _CARD_GRID_SECTION_TYPES]
    if len(card_sections) >= 4:
        issues.append(
            QualityIssue(
                category="structure",
                rule="excessive_card_sections",
                severity="medium",
                message=f"{len(card_sections)} card-grid sections on {page.name} — reads as a generic template stack.",
                location=page.name,
            )
        )
    total_card_items = 0
    for section in card_sections:
        for field in ("services", "features", "members", "projects"):
            total_card_items += len(section.config.get(field, []) or [])
    if total_card_items > 18:
        issues.append(
            QualityIssue(
                category="structure",
                rule="excessive_cards",
                severity="low",
                message=f"{total_card_items} total card items on {page.name} — consider trimming to what's genuinely differentiating.",
                location=page.name,
            )
        )

    # Generic layout: nothing but structural/card sections, no hero or
    # narrative anchor — reads like a template with no real identity.
    has_anchor = any(t in ("hero", "imageContentSplit") for t in content_types)
    if content_types and not has_anchor:
        issues.append(
            QualityIssue(
                category="structure",
                rule="generic_layout",
                severity="low",
                message=f"{page.name} has no hero or image/content section to anchor it — reads as a generic layout.",
                location=page.name,
            )
        )

    return issues


def _check_visual_style(page: PageInput, visual_style: VisualStyleInput) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    location = page.name

    if visual_style.gradient_usage == "heavy":
        issues.append(
            QualityIssue(
                category="visual_slop",
                rule="excessive_gradients",
                severity="medium",
                message="Gradient usage reported as heavy — reserve gradients for one deliberate accent, not a default background treatment.",
                location=location,
            )
        )
    if visual_style.glassmorphism:
        issues.append(
            QualityIssue(
                category="visual_slop",
                rule="unnecessary_glassmorphism",
                severity="medium",
                message="Glassmorphism (frosted-glass panels) reported in use — confirm this serves a specific need, not decoration.",
                location=location,
            )
        )
    if visual_style.border_radius == "heavy":
        issues.append(
            QualityIssue(
                category="visual_slop",
                rule="excessive_rounded_containers",
                severity="low",
                message="Border radius reported as heavy (pill-shaped containers everywhere) — a generic SaaS-template tell.",
                location=location,
            )
        )
    if visual_style.animation_intensity == "heavy":
        issues.append(
            QualityIssue(
                category="visual_slop",
                rule="excessive_animations",
                severity="medium",
                message="Animation intensity reported as heavy — motion should support the content, not distract from it.",
                location=location,
            )
        )
    if visual_style.decorative_element_count > 2:
        issues.append(
            QualityIssue(
                category="visual_slop",
                rule="purposeless_decoration",
                severity="low",
                message=f"{visual_style.decorative_element_count} purely decorative elements reported with no stated function.",
                location=location,
            )
        )
    return issues


# ---------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------


def run(input: AntiSlopInput) -> AgentResult[AntiSlopOutput]:
    issues: list[QualityIssue] = []
    missing_information: list[str] = []

    for page in input.pages:
        missing_information.extend(_check_missing_information(page))
        issues.extend(_check_generic_copy(page))
        issues.extend(_check_unverified_claims(page, input.authentic_content))
        issues.extend(_check_testimonials(page, input.authentic_content))
        issues.extend(_check_stats(page, input.authentic_content))
        issues.extend(_check_stock_imagery(page))
        issues.extend(_check_structure(page))
        issues.extend(_check_visual_style(page, input.visual_style))

    issues.extend(_check_repetitive_phrasing(input.pages))

    score = 100
    for issue in issues:
        score -= _SEVERITY_PENALTY[issue.severity]
    score = max(score, 0)

    has_high_severity = any(issue.severity == "high" for issue in issues)
    passed = score >= 70 and not has_high_severity

    output = AntiSlopOutput(
        score=score,
        passed=passed,
        issues=issues,
        missing_information=missing_information,
    )

    return AgentResult(
        output=output,
        confidence=1.0,
        flagged_for_review=not passed or len(missing_information) > 0,
        notes=None if passed else "Quality issues or missing information detected — see issues/missing_information.",
    )
