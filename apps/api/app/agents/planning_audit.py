"""
Planning's deterministic findings role — turns a single
integrations/browser.py PlanningAuditSignals capture into a list of
evidence-backed Finding objects grouped by area (technical, seo,
accessibility, usability). Same shape and discipline as
agents/website_quality.py: no LLM call, every finding names its
category/severity/message/evidence/confidence, and a signal this app
genuinely didn't measure produces no finding — never a guessed one.

This is Planning's "Key Points" source data: agents/planning_summary.py
only writes the connecting prose paragraph around these findings, it
never adds new ones.
"""

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.browser import PlanningAuditSignals

Severity = str  # "low" | "medium" | "high" | "critical" — kept as str, see website_quality.Severity

SLOW_LOAD_MS = 4000
MODERATE_LOAD_MS = 2000
LARGE_PAGE_BYTES = 3_000_000
MIN_ACCEPTABLE_CONTRAST = 4.5


class Finding(BaseModel):
    area: str  # "technical" | "seo" | "accessibility" | "usability" | "visual"
    category: str
    severity: str
    message: str
    evidence: str
    confidence: float


class PlanningAuditFindingsOutput(BaseModel):
    findings: list[Finding]


def run(signals: PlanningAuditSignals) -> AgentResult[PlanningAuditFindingsOutput]:
    if signals.error:
        findings = [
            Finding(
                area="technical",
                category="availability",
                severity="critical",
                message="The website did not load during the audit — visitors likely hit the same failure.",
                evidence=signals.error,
                confidence=1.0,
            )
        ]
        return AgentResult(
            output=PlanningAuditFindingsOutput(findings=findings),
            confidence=1.0,
            flagged_for_review=True,
            notes="Website was unreachable during the audit — findings limited to availability.",
        )

    findings: list[Finding] = []

    if signals.https is False:
        findings.append(
            Finding(
                area="technical",
                category="security",
                severity="high",
                message="The site is not served over HTTPS — most browsers show visitors a security warning.",
                evidence="Page loaded without HTTPS",
                confidence=1.0,
            )
        )

    if signals.load_time_ms is not None:
        if signals.load_time_ms > SLOW_LOAD_MS:
            findings.append(
                Finding(
                    area="technical",
                    category="performance",
                    severity="high",
                    message=f"The homepage took {signals.load_time_ms}ms to load — slow enough that visitors may leave before it finishes.",
                    evidence=f"Measured load time: {signals.load_time_ms}ms",
                    confidence=0.9,
                )
            )
        elif signals.load_time_ms > MODERATE_LOAD_MS:
            findings.append(
                Finding(
                    area="technical",
                    category="performance",
                    severity="medium",
                    message=f"The homepage took {signals.load_time_ms}ms to load — noticeably slower than a well-optimized site.",
                    evidence=f"Measured load time: {signals.load_time_ms}ms",
                    confidence=0.9,
                )
            )

    if signals.total_transfer_bytes is not None and signals.total_transfer_bytes > LARGE_PAGE_BYTES:
        mb = signals.total_transfer_bytes / 1_000_000
        findings.append(
            Finding(
                area="technical",
                category="performance",
                severity="medium",
                message=f"The homepage transfers about {mb:.1f}MB of data — large assets can slow the page down, especially on mobile.",
                evidence=f"Measured page weight: {signals.total_transfer_bytes} bytes",
                confidence=0.85,
            )
        )

    if signals.broken_internal_links:
        findings.append(
            Finding(
                area="technical",
                category="broken_links",
                severity="high",
                message=f"{len(signals.broken_internal_links)} internal link(s) checked from the homepage returned an error.",
                evidence=f"Broken paths: {', '.join(signals.broken_internal_links)}",
                confidence=0.9,
            )
        )

    if signals.console_error_count:
        findings.append(
            Finding(
                area="technical",
                category="errors",
                severity="medium",
                message=f"The page logged {signals.console_error_count} JavaScript error(s) in the browser console.",
                evidence=f"{signals.console_error_count} console error(s) observed on load",
                confidence=0.85,
            )
        )

    if signals.duplicate_ids:
        findings.append(
            Finding(
                area="technical",
                category="markup",
                severity="low",
                message="The page reuses the same element ID in more than one place, which can break in-page links and scripts.",
                evidence=f"Duplicate IDs: {', '.join(signals.duplicate_ids)}",
                confidence=0.9,
            )
        )

    if signals.viewport_meta_present is False:
        findings.append(
            Finding(
                area="usability",
                category="mobile",
                severity="high",
                message="No mobile viewport tag was found, so the site likely doesn't adapt to phone screens.",
                evidence='No <meta name="viewport"> tag found',
                confidence=0.85,
            )
        )
    if signals.mobile_overflow:
        findings.append(
            Finding(
                area="usability",
                category="mobile",
                severity="high",
                message="Content overflows horizontally at mobile width — visitors would need to scroll sideways to read it.",
                evidence="Horizontal overflow detected at 375px viewport width",
                confidence=0.9,
            )
        )
    elif signals.tablet_overflow:
        findings.append(
            Finding(
                area="usability",
                category="mobile",
                severity="medium",
                message="Content overflows horizontally at tablet width.",
                evidence="Horizontal overflow detected at tablet viewport width",
                confidence=0.85,
            )
        )

    if signals.contact_cta_present is False:
        findings.append(
            Finding(
                area="usability",
                category="conversion_path",
                severity="high",
                message="No clear way for a visitor to get in touch was found on the homepage — no phone/email link or contact form.",
                evidence="No mailto/tel link or <form> found on the page",
                confidence=0.8,
            )
        )

    if signals.min_contrast_ratio is not None and signals.min_contrast_ratio < MIN_ACCEPTABLE_CONTRAST:
        findings.append(
            Finding(
                area="accessibility",
                category="contrast",
                severity="medium",
                message=f"At least one text element measured a contrast ratio of {signals.min_contrast_ratio:.1f}:1 against its background — below the {MIN_ACCEPTABLE_CONTRAST}:1 usually recommended for readability.",
                evidence=f"Measured minimum contrast ratio: {signals.min_contrast_ratio:.2f}:1",
                confidence=0.75,
            )
        )

    if signals.html_lang_present is False:
        findings.append(
            Finding(
                area="accessibility",
                category="markup",
                severity="low",
                message="The page doesn't declare a language on the <html> element, which affects screen readers and search engines.",
                evidence='No lang attribute found on <html>',
                confidence=0.9,
            )
        )

    if signals.h1_count == 0:
        findings.append(
            Finding(
                area="seo",
                category="heading_structure",
                severity="medium",
                message="The homepage has no main heading (H1) — this weakens both page structure and search visibility.",
                evidence="0 <h1> elements found",
                confidence=0.85,
            )
        )
    elif signals.h1_count is not None and signals.h1_count > 1:
        findings.append(
            Finding(
                area="seo",
                category="heading_structure",
                severity="low",
                message=f"The homepage has {signals.h1_count} main headings (H1) rather than one — this can dilute page hierarchy and SEO signals.",
                evidence=f"{signals.h1_count} <h1> elements found",
                confidence=0.75,
            )
        )

    if not signals.title:
        findings.append(
            Finding(
                area="seo",
                category="business_information",
                severity="medium",
                message="The page has no title — this also hurts how the business shows up in search results.",
                evidence="No <title> content found",
                confidence=0.95,
            )
        )
    if not signals.meta_description:
        findings.append(
            Finding(
                area="seo",
                category="business_information",
                severity="low",
                message="The page has no meta description, which search engines use for the result snippet.",
                evidence="No meta description found",
                confidence=0.95,
            )
        )
    if signals.canonical_present is False:
        findings.append(
            Finding(
                area="seo",
                category="technical_seo",
                severity="low",
                message="The page doesn't declare a canonical URL, which can matter for search engines if the same content is reachable at more than one address.",
                evidence='No <link rel="canonical"> tag found',
                confidence=0.75,
            )
        )
    if signals.meta_robots_noindex:
        findings.append(
            Finding(
                area="seo",
                category="technical_seo",
                severity="critical",
                message="The page is explicitly marked noindex — search engines are being told not to index it.",
                evidence='<meta name="robots"> contains "noindex"',
                confidence=0.95,
            )
        )
    if signals.sitemap_xml_reachable is False:
        findings.append(
            Finding(
                area="seo",
                category="technical_seo",
                severity="low",
                message="No sitemap.xml was found at the site root — this can make it slower for search engines to discover all pages.",
                evidence="/sitemap.xml did not return a successful response",
                confidence=0.7,
            )
        )
    if signals.has_local_business_schema is False or signals.has_local_business_schema is None:
        findings.append(
            Finding(
                area="seo",
                category="local_seo",
                severity="medium",
                message="No LocalBusiness structured data (schema.org markup) was found — this is commonly used to help the business appear in local search results and map listings.",
                evidence="No LocalBusiness-type schema.org markup found on the page",
                confidence=0.7,
            )
        )
    if signals.appears_template_or_placeholder:
        findings.append(
            Finding(
                area="visual",
                category="content",
                severity="medium",
                message="Placeholder or unfinished content is still visible on the live page.",
                evidence="Placeholder text (e.g. 'lorem ipsum') found on the page",
                confidence=0.9,
            )
        )

    return AgentResult(output=PlanningAuditFindingsOutput(findings=findings))
