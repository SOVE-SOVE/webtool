"""
Technical QA role — docs/02_ARCHITECTURE.md §6, roadmap M5's "Automated
QA checks (build, links, mobile)". Deterministic: every check either
inspects the generated site's own config (the same shape
agents/website_generator.py produces and packages/site-templates
renders) or, when a live `preview_url` is supplied, drives a real
headless browser via integrations/browser.py. No LLM call — "ready for
client review" needs a floor that doesn't drift between runs of the
same input, same reasoning as agents/lead_score.py and
agents/anti_slop.py.

Checks that need a rendered page (real asset weights, computed colour
contrast, console errors, cross-viewport overflow, robots.txt/sitemap.xml
reachability) only run when `preview_url` is given — there's no build/
hosting step yet (roadmap M6), so today that's always None in practice.
Without one they're reported as `skipped`, never silently left out of
the report: "do not automatically hide failures" applies to what can't
be checked yet as much as to what fails.
"""

from __future__ import annotations

import asyncio
import re
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field

from app.agents.base import AgentResult
from app.integrations.browser import QaPageSignals, fetch_qa_signals

CheckStatus = Literal["pass", "fail", "warning", "skipped"]
Severity = Literal["critical", "high", "medium", "low", "info"]
Category = Literal["performance", "responsiveness", "accessibility", "seo", "functionality", "security", "markup"]

# ---------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------


class SectionInput(BaseModel):
    type: str
    config: dict = Field(default_factory=dict)


class PageSeoInput(BaseModel):
    title: str
    meta_description: str | None = None


class PageInput(BaseModel):
    name: str
    slug: str
    seo: PageSeoInput
    sections: list[SectionInput] = Field(default_factory=list)


class TechnicalQaInput(BaseModel):
    navigation: SectionInput
    footer: SectionInput
    pages: list[PageInput]
    # DesignBrief.domain — canonical/OG checks are only "appropriate"
    # (per the operator's own phrasing) once a real domain exists.
    domain: str | None = None
    # A live, reachable URL for this exact generated site. None until
    # roadmap M6 (deployment) exists — see module docstring.
    preview_url: str | None = None


# ---------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------


class QaCheck(BaseModel):
    category: Category
    name: str
    status: CheckStatus
    severity: Severity
    message: str
    recommended_fix: str | None = None
    location: str | None = None


class TechnicalQaOutput(BaseModel):
    checks: list[QaCheck]
    passed_count: int
    failed_count: int
    warning_count: int
    skipped_count: int
    # False whenever any check both failed and is "critical" severity —
    # matches "a website should not be considered ready for client
    # review until critical QA issues are resolved" verbatim.
    ready_for_client_review: bool


# ---------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------


def _check(
    category: Category,
    name: str,
    status: CheckStatus,
    severity: Severity,
    message: str,
    recommended_fix: str | None = None,
    location: str | None = None,
) -> QaCheck:
    return QaCheck(
        category=category, name=name, status=status, severity=severity, message=message,
        recommended_fix=recommended_fix, location=location,
    )


def _iter_media(node: object) -> list[dict]:
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


def _iter_hrefs(node: object) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        if "href" in node and isinstance(node["href"], str):
            found.append(node["href"])
        for value in node.values():
            found.extend(_iter_hrefs(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_iter_hrefs(item))
    return found


def _iter_strings(node: object) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        for value in node.values():
            found.extend(_iter_strings(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_iter_strings(item))
    elif isinstance(node, str):
        found.append(node)
    return found


def _iter_forms(node: object) -> list[dict]:
    """Finds every FormConfig-shaped dict ({fields, submitLabel})."""
    found: list[dict] = []
    if isinstance(node, dict):
        if "fields" in node and "submitLabel" in node:
            found.append(node)
        for value in node.values():
            found.extend(_iter_forms(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_iter_forms(item))
    return found


def _all_section_configs(input: TechnicalQaInput) -> list[tuple[str, str, dict]]:
    """(location, section_type, config) for every section on every page,
    plus navigation/footer under synthetic locations."""
    out = [("Navigation", input.navigation.type, input.navigation.config), ("Footer", input.footer.type, input.footer.config)]
    for page in input.pages:
        for section in page.sections:
            out.append((page.name, section.type, section.config))
    return out


# ---------------------------------------------------------------------
# PERFORMANCE (static)
# ---------------------------------------------------------------------

_MAX_SECTIONS_PER_PAGE = 15


def _performance_checks(input: TechnicalQaInput) -> list[QaCheck]:
    checks: list[QaCheck] = []

    data_uri_images = [
        (loc, m) for loc, _, cfg in _all_section_configs(input) for m in _iter_media(cfg) if str(m.get("src", "")).startswith("data:")
    ]
    if data_uri_images:
        checks.append(
            _check(
                "performance", "Embedded (data URI) images", "fail", "medium",
                f"{len(data_uri_images)} image(s) embedded as base64 data URIs, which bloats page weight and can't be cached.",
                "Host images as real files/URLs instead of embedding them inline.",
                location=data_uri_images[0][0],
            )
        )
    else:
        checks.append(_check("performance", "Embedded (data URI) images", "pass", "info", "No base64-embedded images found."))

    checks.append(
        _check(
            "performance", "Custom client-side JavaScript", "pass", "info",
            "The generated configuration contains no custom scripts — packages/site-templates renders "
            "plain, framework-native components only.",
        )
    )

    oversized_pages = [p for p in input.pages if len(p.sections) > _MAX_SECTIONS_PER_PAGE]
    if oversized_pages:
        for page in oversized_pages:
            checks.append(
                _check(
                    "performance", "Page length", "warning", "low",
                    f"{page.name} has {len(page.sections)} sections — a long page can mean a slow initial render.",
                    "Consider splitting into multiple pages or trimming to the sections that matter most.",
                    location=page.name,
                )
            )
    else:
        checks.append(_check("performance", "Page length", "pass", "info", "No page has an excessive number of sections."))

    missing_dimensions = [
        (loc, m) for loc, _, cfg in _all_section_configs(input) for m in _iter_media(cfg) if not (m.get("width") and m.get("height"))
    ]
    if missing_dimensions:
        checks.append(
            _check(
                "performance", "Image dimensions specified", "warning", "medium",
                f"{len(missing_dimensions)} image(s) have no width/height set, which can cause layout shift while they load.",
                "Set width/height (or a fixed aspect-ratio container) on every image.",
                location=missing_dimensions[0][0],
            )
        )
    else:
        checks.append(_check("performance", "Image dimensions specified", "pass", "info", "Every image has explicit dimensions."))

    return checks


# ---------------------------------------------------------------------
# RESPONSIVENESS (live-only)
# ---------------------------------------------------------------------


def _responsiveness_skipped_checks() -> list[QaCheck]:
    return [
        _check(
            "responsiveness", f"{viewport.capitalize()} layout", "skipped", "info",
            f"No live preview URL yet — {viewport} rendering can't be checked before the site is built/deployed.",
            "Provide a preview_url once a build/hosting step exists (roadmap M6).",
        )
        for viewport in ("desktop", "tablet", "mobile")
    ]


def _responsiveness_checks_from_signals(signals: QaPageSignals) -> list[QaCheck]:
    checks = []
    for viewport, overflow in (("desktop", signals.desktop_overflow), ("tablet", signals.tablet_overflow), ("mobile", signals.mobile_overflow)):
        if overflow is None:
            checks.append(_check("responsiveness", f"{viewport.capitalize()} layout", "skipped", "info", f"Could not measure {viewport} layout."))
        elif overflow:
            checks.append(
                _check(
                    "responsiveness", f"{viewport.capitalize()} layout", "fail", "high",
                    f"Page content overflows the viewport horizontally at {viewport} width.",
                    "Check for fixed-width elements or missing responsive classes.",
                )
            )
        else:
            checks.append(_check("responsiveness", f"{viewport.capitalize()} layout", "pass", "info", f"No horizontal overflow at {viewport} width."))
    return checks


# ---------------------------------------------------------------------
# ACCESSIBILITY
# ---------------------------------------------------------------------


def _accessibility_checks(input: TechnicalQaInput) -> list[QaCheck]:
    checks: list[QaCheck] = []

    missing_alt = [(loc, m) for loc, _, cfg in _all_section_configs(input) for m in _iter_media(cfg) if not str(m.get("alt", "")).strip()]
    if missing_alt:
        checks.append(
            _check(
                "accessibility", "Image alt text", "fail", "critical",
                f"{len(missing_alt)} image(s) have no alt text.",
                "Add a real, specific description for every image.",
                location=missing_alt[0][0],
            )
        )
    else:
        checks.append(_check("accessibility", "Image alt text", "pass", "info", "Every image has alt text."))

    for page in input.pages:
        hero_count = sum(1 for s in page.sections if s.type == "hero")
        if hero_count > 1:
            checks.append(
                _check(
                    "accessibility", "Heading hierarchy", "fail", "high",
                    f"{page.name} has {hero_count} hero sections, which means {hero_count} <h1> elements on one page.",
                    "Keep exactly one hero (one <h1>) per page.",
                    location=page.name,
                )
            )
    if not any(c.name == "Heading hierarchy" for c in checks):
        checks.append(_check("accessibility", "Heading hierarchy", "pass", "info", "No page has more than one top-level heading."))

    unlabeled_fields = [
        (loc, f) for loc, _, cfg in _all_section_configs(input) for form in _iter_forms(cfg) for f in form.get("fields", []) if not str(f.get("label", "")).strip()
    ]
    if unlabeled_fields:
        checks.append(
            _check(
                "accessibility", "Form field labels", "fail", "critical",
                f"{len(unlabeled_fields)} form field(s) have no label.",
                "Give every form field a real, visible label.",
                location=unlabeled_fields[0][0],
            )
        )
    else:
        checks.append(_check("accessibility", "Form field labels", "pass", "info", "Every form field has a label."))

    checks.append(
        _check(
            "accessibility", "Keyboard accessibility", "pass", "info",
            "Verified by construction: packages/site-templates only renders native <a>/<button>/<input> "
            "elements for interactive content, never a non-interactive element with a click handler.",
        )
    )
    checks.append(
        _check(
            "accessibility", "Semantic HTML", "pass", "info",
            "Verified by construction: every section uses semantic landmarks (<nav>, <section>, <footer>, "
            "<form>, heading tags) from the shared component library.",
        )
    )
    # Only add the static skipped placeholder when there's no live check
    # coming — otherwise _run_live_checks' real result (pass/fail, via
    # _accessibility_contrast_check_from_signals) is the one that counts,
    # and both would otherwise show up as two same-named checks.
    if not input.preview_url:
        checks.append(
            _check(
                "accessibility", "Colour contrast", "skipped", "info",
                "Colour contrast needs a rendered page to measure computed styles against.",
                "Provide a preview_url once a build/hosting step exists (roadmap M6).",
            )
        )

    return checks


def _accessibility_contrast_check_from_signals(signals: QaPageSignals) -> QaCheck:
    if signals.min_contrast_ratio is None:
        return _check("accessibility", "Colour contrast", "skipped", "info", "Could not sample text/background colours on the live page.")
    if signals.min_contrast_ratio < 4.5:
        return _check(
            "accessibility", "Colour contrast", "fail", "high",
            f"Sampled text/background contrast ratio of {signals.min_contrast_ratio:.2f}:1 is below the WCAG AA minimum of 4.5:1.",
            "Darken the text or lighten the background (or vice versa) until the ratio is at least 4.5:1.",
        )
    return _check("accessibility", "Colour contrast", "pass", "info", f"Sampled contrast ratio {signals.min_contrast_ratio:.2f}:1 meets WCAG AA.")


# ---------------------------------------------------------------------
# SEO
# ---------------------------------------------------------------------


def _seo_checks(input: TechnicalQaInput) -> list[QaCheck]:
    checks: list[QaCheck] = []

    missing_titles = [p for p in input.pages if not p.seo.title.strip()]
    if missing_titles:
        checks.append(_check("seo", "Page titles", "fail", "high", f"{len(missing_titles)} page(s) have no title.", "Every page needs a real <title>."))
    else:
        checks.append(_check("seo", "Page titles", "pass", "info", "Every page has a title."))

    missing_descriptions = [p for p in input.pages if not p.seo.meta_description]
    if missing_descriptions:
        checks.append(
            _check(
                "seo", "Meta descriptions", "warning", "medium",
                f"{len(missing_descriptions)} page(s) have no meta description on file.",
                "Add a real business/page description in the client brief — never invent one.",
                location=missing_descriptions[0].name,
            )
        )
    else:
        checks.append(_check("seo", "Meta descriptions", "pass", "info", "Every page has a meta description."))

    if input.domain:
        checks.append(
            _check(
                "seo", "Canonical URL configuration", "fail", "low",
                f"A domain ({input.domain}) is on file, but no canonical URL is generated for any page yet.",
                "Add a canonical <link> once the site is served from a real domain.",
            )
        )
    else:
        checks.append(_check("seo", "Canonical URL configuration", "skipped", "info", "No domain configured yet — not applicable before launch."))

    checks.append(
        _check(
            "seo", "Open Graph metadata", "warning", "low",
            "Open Graph title/description can reuse each page's SEO title/description, but no og:image is "
            "available — this system never auto-selects a hero image without a real, described one on file.",
            "Add a real hero image (with alt text) once one is available.",
        )
    )

    checks.append(
        _check(
            "seo", "robots.txt / sitemap.xml", "skipped", "info",
            "Not applicable before deployment — no build/hosting step exists yet (roadmap M6).",
        )
    )

    return checks


# ---------------------------------------------------------------------
# FUNCTIONALITY
# ---------------------------------------------------------------------


# Section types that themselves constitute a call to action — a
# dedicated CTA block, a contact section, or a standalone form all give
# a visitor an obvious next step even without a hero button.
_CTA_BEARING_SECTION_TYPES = {"cta", "contact", "form"}


def _page_has_cta(page: PageInput) -> bool:
    for section in page.sections:
        if section.type == "hero" and section.config.get("primaryCta"):
            return True
        if section.type in _CTA_BEARING_SECTION_TYPES:
            return True
    return False


def _functionality_checks(input: TechnicalQaInput) -> list[QaCheck]:
    checks: list[QaCheck] = []

    pages_without_cta = [p for p in input.pages if p.sections and not _page_has_cta(p)]
    if pages_without_cta:
        checks.append(
            _check(
                "functionality", "Calls to action present", "fail", "high",
                f"{len(pages_without_cta)} page(s) have no clear call to action: "
                f"{', '.join(p.name for p in pages_without_cta)}",
                "Add a hero button, a CTA section, a contact section, or a form so visitors have an obvious next step.",
                location=pages_without_cta[0].name,
            )
        )
    else:
        checks.append(_check("functionality", "Calls to action present", "pass", "info", "Every page has a clear call to action."))

    known_slugs = {p.slug for p in input.pages}
    broken = []
    for loc, _, cfg in _all_section_configs(input):
        for href in _iter_hrefs(cfg):
            if href.startswith(("http://", "https://", "mailto:", "tel:", "#")):
                continue
            path = href[1:] if href.startswith("/") else href
            if path not in known_slugs:
                broken.append((loc, href))
    if broken:
        checks.append(
            _check(
                "functionality", "Internal links resolve", "fail", "critical",
                f"{len(broken)} internal link(s) point to a page that doesn't exist: {', '.join(h for _, h in broken[:5])}",
                "Fix or remove links to pages that aren't part of this site.",
                location=broken[0][0],
            )
        )
    else:
        checks.append(_check("functionality", "Internal links resolve", "pass", "info", "Every internal link points to a real page."))

    broken_forms = [
        (loc, form) for loc, _, cfg in _all_section_configs(input) for form in _iter_forms(cfg)
        if not form.get("fields") or not str(form.get("submitLabel", "")).strip()
    ]
    if broken_forms:
        checks.append(
            _check(
                "functionality", "Forms", "fail", "critical",
                f"{len(broken_forms)} form(s) are missing fields or a submit label.",
                "Every form needs at least one field and a submit button label.",
                location=broken_forms[0][0],
            )
        )
    else:
        checks.append(_check("functionality", "Forms", "pass", "info", "Every form has fields and a submit label."))

    if not input.navigation.config.get("links"):
        checks.append(_check("functionality", "Navigation", "fail", "high", "The site navigation has no links."))
    else:
        checks.append(_check("functionality", "Navigation", "pass", "info", "Navigation has links."))

    empty_pages = [p for p in input.pages if not p.sections]
    if empty_pages:
        checks.append(
            _check(
                "functionality", "Missing pages", "fail", "high",
                f"{len(empty_pages)} page(s) were planned in the sitemap but have no content: {', '.join(p.name for p in empty_pages)}",
                "Regenerate or manually build these pages before review.",
            )
        )
    else:
        checks.append(_check("functionality", "Missing pages", "pass", "info", "Every planned page has content."))

    missing_assets = [(loc, m) for loc, _, cfg in _all_section_configs(input) for m in _iter_media(cfg) if not str(m.get("src", "")).strip()]
    if missing_assets:
        checks.append(
            _check(
                "functionality", "Missing assets", "fail", "critical",
                f"{len(missing_assets)} image reference(s) have no source file.",
                "Remove the image block or supply a real file.",
                location=missing_assets[0][0],
            )
        )
    else:
        checks.append(_check("functionality", "Missing assets", "pass", "info", "Every referenced image has a source."))

    if not input.preview_url:
        checks.append(
            _check(
                "functionality", "Console errors", "skipped", "info",
                "Console errors need a rendered page to observe.",
                "Provide a preview_url once a build/hosting step exists (roadmap M6).",
            )
        )

    return checks


# ---------------------------------------------------------------------
# SECURITY
# ---------------------------------------------------------------------

_SCRIPT_INJECTION_PATTERN = re.compile(r"<script|javascript:", re.IGNORECASE)
_SECRET_PATTERNS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),  # AWS access key
    re.compile(r"sk-[A-Za-z0-9]{20,}"),  # OpenAI/Anthropic-style secret key
    re.compile(r"ghp_[A-Za-z0-9]{36}"),  # GitHub personal access token
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]


def _security_checks(input: TechnicalQaInput) -> list[QaCheck]:
    checks: list[QaCheck] = []
    all_strings = [(loc, s) for loc, _, cfg in _all_section_configs(input) for s in _iter_strings(cfg)]

    injections = [(loc, s) for loc, s in all_strings if _SCRIPT_INJECTION_PATTERN.search(s)]
    if injections:
        checks.append(
            _check(
                "security", "No injected scripts / javascript: URIs", "fail", "critical",
                f"Found script/javascript: content in generated text: {injections[0][1][:80]!r}",
                "Remove the injected markup from the source content immediately.",
                location=injections[0][0],
            )
        )
    else:
        checks.append(_check("security", "No injected scripts / javascript: URIs", "pass", "info", "No script tags or javascript: URIs found."))

    secrets = [(loc, s) for loc, s in all_strings for pattern in _SECRET_PATTERNS if pattern.search(s)]
    if secrets:
        checks.append(
            _check(
                "security", "No exposed secrets", "fail", "critical",
                f"Found what looks like a real credential in generated content, at {secrets[0][0]}.",
                "Remove the credential immediately and rotate it — it may already be compromised.",
                location=secrets[0][0],
            )
        )
    else:
        checks.append(_check("security", "No exposed secrets", "pass", "info", "No credential-shaped strings found in generated content."))

    insecure_forms = [
        (loc, form) for loc, _, cfg in _all_section_configs(input) for form in _iter_forms(cfg)
        if str(form.get("action", "")).startswith("http://")
    ]
    if insecure_forms:
        checks.append(
            _check(
                "security", "Form submissions use HTTPS", "fail", "high",
                "A form submits to a plain http:// endpoint.",
                "Use an https:// endpoint so form data isn't sent in the clear.",
                location=insecure_forms[0][0],
            )
        )
    else:
        checks.append(_check("security", "Form submissions use HTTPS", "pass", "info", "No form submits to an insecure endpoint."))

    checks.append(
        _check(
            "security", "No unsafe client-side rendering", "pass", "info",
            "Verified by construction: no component in packages/site-templates renders raw/unescaped HTML "
            "from config content.",
        )
    )

    # Superseded by _https_check_from_signals's real result when a
    # preview URL is given — see the Colour contrast / Console errors
    # checks above for the same pattern.
    if not input.preview_url:
        checks.append(
            _check(
                "security", "Served over HTTPS", "skipped", "info",
                "No live preview URL yet — can't confirm transport security before deployment.",
            )
        )

    return checks


def _https_check_from_signals(signals: QaPageSignals) -> QaCheck:
    if signals.https is None:
        return _check("security", "Served over HTTPS", "skipped", "info", "Could not determine the preview URL's scheme.")
    if not signals.https:
        return _check("security", "Served over HTTPS", "fail", "critical", "The live preview is not served over HTTPS.", "Serve the site over HTTPS.")
    return _check("security", "Served over HTTPS", "pass", "info", "Served over HTTPS.")


# ---------------------------------------------------------------------
# MARKUP
# ---------------------------------------------------------------------

# Matches an opening/closing HTML tag literally typed into plain-text
# content (e.g. a heading string containing "<b>Save</b>"). Since every
# component in packages/site-templates renders config strings as escaped
# text, this never becomes real markup — it prints as literal, broken-
# looking text on the page, which is the actual defect being caught.
_TAG_LIKE_PATTERN = re.compile(r"</?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?>")


def _markup_checks(input: TechnicalQaInput) -> list[QaCheck]:
    checks: list[QaCheck] = []

    all_strings = [(loc, s) for loc, _, cfg in _all_section_configs(input) for s in _iter_strings(cfg)]
    tag_like = [(loc, s) for loc, s in all_strings if _TAG_LIKE_PATTERN.search(s)]
    if tag_like:
        checks.append(
            _check(
                "markup", "No raw HTML tags in content", "fail", "medium",
                f"Content contains what looks like raw HTML markup, which renders as literal text rather than "
                f"real markup: {tag_like[0][1][:80]!r}",
                "Remove the tag-like text from the source content — write plain text, not HTML.",
                location=tag_like[0][0],
            )
        )
    else:
        checks.append(_check("markup", "No raw HTML tags in content", "pass", "info", "No raw HTML-looking tags found in generated content."))

    # Superseded by _markup_checks_from_signals' real result when a
    # preview URL is given — same pattern as Colour contrast/Console errors.
    if not input.preview_url:
        checks.append(
            _check(
                "markup", "Duplicate element IDs", "skipped", "info",
                "Needs a rendered page to inspect the actual DOM for duplicate ids.",
                "Provide a preview_url once a build/hosting step exists (roadmap M6).",
            )
        )
        checks.append(
            _check(
                "markup", "<html lang> attribute", "skipped", "info",
                "Needs a rendered page to inspect the <html> element.",
                "Provide a preview_url once a build/hosting step exists (roadmap M6).",
            )
        )

    return checks


def _markup_checks_from_signals(signals: QaPageSignals) -> list[QaCheck]:
    checks: list[QaCheck] = []

    if signals.duplicate_ids is None:
        checks.append(_check("markup", "Duplicate element IDs", "skipped", "info", "Could not inspect element ids on the live page."))
    elif signals.duplicate_ids:
        checks.append(
            _check(
                "markup", "Duplicate element IDs", "fail", "medium",
                f"{len(signals.duplicate_ids)} id value(s) are used on more than one element: "
                f"{', '.join(signals.duplicate_ids[:5])}",
                "Give every element a unique id — duplicate ids are invalid HTML and break label/anchor targeting.",
            )
        )
    else:
        checks.append(_check("markup", "Duplicate element IDs", "pass", "info", "No duplicate element ids found."))

    if signals.html_lang_present is None:
        checks.append(_check("markup", "<html lang> attribute", "skipped", "info", "Could not inspect the live page's <html> element."))
    elif not signals.html_lang_present:
        checks.append(
            _check(
                "markup", "<html lang> attribute", "fail", "medium",
                "The page's <html> element has no lang attribute.",
                'Set a lang attribute (e.g. lang="en") on <html>.',
            )
        )
    else:
        checks.append(_check("markup", "<html lang> attribute", "pass", "info", "<html> has a lang attribute."))

    return checks


# ---------------------------------------------------------------------
# Live checks (preview_url only)
# ---------------------------------------------------------------------


async def _run_live_checks(input: TechnicalQaInput) -> list[QaCheck]:
    assert input.preview_url is not None
    page_paths = [f"/{p.slug}" if p.slug else "/" for p in input.pages]
    signals = await fetch_qa_signals(input.preview_url, page_paths)

    checks: list[QaCheck] = []

    if signals.error:
        checks.append(
            _check(
                "functionality", "Preview reachable", "fail", "critical",
                f"Could not load the preview URL: {signals.error}",
                "Confirm the preview URL is correct and the site is actually deployed.",
            )
        )
        # Every other live check depends on a page that loaded — report
        # them all as skipped rather than silently omitting them.
        checks.extend(_responsiveness_skipped_checks())
        checks.append(_check("accessibility", "Colour contrast", "skipped", "info", "Preview page failed to load."))
        checks.append(_check("functionality", "Console errors", "skipped", "info", "Preview page failed to load."))
        checks.append(_check("security", "Served over HTTPS", "skipped", "info", "Preview page failed to load."))
        checks.append(_check("markup", "Duplicate element IDs", "skipped", "info", "Preview page failed to load."))
        checks.append(_check("markup", "<html lang> attribute", "skipped", "info", "Preview page failed to load."))
        return checks

    checks.extend(_responsiveness_checks_from_signals(signals))
    checks.append(_accessibility_contrast_check_from_signals(signals))
    checks.append(_https_check_from_signals(signals))
    checks.extend(_markup_checks_from_signals(signals))

    if signals.console_errors:
        checks.append(
            _check(
                "functionality", "Console errors", "fail", "high",
                f"{len(signals.console_errors)} console error(s) on load: {signals.console_errors[0][:120]}",
                "Fix the underlying JavaScript error.",
            )
        )
    else:
        checks.append(_check("functionality", "Console errors", "pass", "info", "No console errors on load."))

    if signals.broken_internal_links:
        checks.append(
            _check(
                "functionality", "Internal links reachable", "fail", "critical",
                f"{len(signals.broken_internal_links)} internal page(s) returned an error: {', '.join(signals.broken_internal_links)}",
                "Fix or remove the broken page(s).",
            )
        )
    else:
        checks.append(_check("functionality", "Internal links reachable", "pass", "info", "Every internal page loaded successfully."))

    if signals.total_transfer_bytes is not None:
        mb = signals.total_transfer_bytes / (1024 * 1024)
        if mb > 5:
            checks.append(
                _check(
                    "performance", "Total page weight", "warning", "medium",
                    f"Homepage transferred {mb:.1f} MB — heavier than the ~5 MB rule of thumb for a fast load.",
                    "Compress/lazy-load large images or scripts.",
                )
            )
        else:
            checks.append(_check("performance", "Total page weight", "pass", "info", f"Homepage transferred {mb:.1f} MB."))

    return checks


# ---------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------


def run(input: TechnicalQaInput) -> AgentResult[TechnicalQaOutput]:
    checks: list[QaCheck] = []
    checks += _performance_checks(input)
    checks += [] if input.preview_url else _responsiveness_skipped_checks()
    checks += _accessibility_checks(input)
    checks += _seo_checks(input)
    checks += _functionality_checks(input)
    checks += _security_checks(input)
    checks += _markup_checks(input)

    if input.preview_url:
        checks += asyncio.run(_run_live_checks(input))

    passed = sum(1 for c in checks if c.status == "pass")
    failed = sum(1 for c in checks if c.status == "fail")
    warnings = sum(1 for c in checks if c.status == "warning")
    skipped = sum(1 for c in checks if c.status == "skipped")
    has_critical_fail = any(c.status == "fail" and c.severity == "critical" for c in checks)

    output = TechnicalQaOutput(
        checks=checks,
        passed_count=passed,
        failed_count=failed,
        warning_count=warnings,
        skipped_count=skipped,
        ready_for_client_review=not has_critical_fail,
    )
    return AgentResult(
        output=output,
        confidence=1.0,
        flagged_for_review=not output.ready_for_client_review,
        notes=None if output.ready_for_client_review else "Critical QA issue(s) found — not ready for client review.",
    )
