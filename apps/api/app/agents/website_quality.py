"""
Website quality analysis — docs/04_ROADMAP.md Lead Intelligence stage 3.
Deterministic, no LLM call, same approach as agents/website_audit.py and
agents/lead_score.py: turns a BusinessResearchResult's real, measured
signals into structured findings a salesperson can use to make the case
for a redesign. Every finding names its category, severity, the
evidence behind it, and a confidence — a category this app genuinely
can't measure from research (information hierarchy, accessibility
beyond what's detectable, precise visual "datedness") simply produces no
finding, never a guessed one. Higher issue count / severity = a more
concrete pitch, mirroring agents/lead_score.py's "more fixable problems
= better-fit lead" framing — this module only classifies findings, it
doesn't score (agents/opportunity_score.py, a separate stage, does).
"""

from typing import Literal

from pydantic import BaseModel

from app.agents.base import AgentResult

Severity = Literal["low", "medium", "high", "critical"]

SLOW_LOAD_MS = 4000
MODERATE_LOAD_MS = 2000
_SUMMARY_PREVIEW_COUNT = 3


class Finding(BaseModel):
    category: str
    severity: Severity
    message: str
    evidence: str
    confidence: float


class WebsiteQualityInput(BaseModel):
    website_reachable: bool | None
    research_error: str | None = None
    https: bool | None = None
    mobile_viewport_present: bool | None = None
    load_time_ms: int | None = None
    contact_cta_present: bool | None = None
    page_title: str | None = None
    meta_description: str | None = None
    appears_template_or_placeholder: bool | None = None


class WebsiteQualityOutput(BaseModel):
    findings: list[Finding]
    summary: str


def _summarize(findings: list[Finding]) -> str:
    if not findings:
        return "No significant issues found in the available research — a redesign pitch here needs a different angle."
    critical = sum(1 for f in findings if f.severity == "critical")
    high = sum(1 for f in findings if f.severity == "high")
    lead = f"{len(findings)} issue(s) found"
    if critical:
        lead += f", including {critical} critical"
    elif high:
        lead += f", including {high} high-severity"
    preview = "; ".join(f.message for f in findings[:_SUMMARY_PREVIEW_COUNT])
    if len(findings) > _SUMMARY_PREVIEW_COUNT:
        preview += "…"
    return f"{lead} — {preview}"


def run(input: WebsiteQualityInput) -> AgentResult[WebsiteQualityOutput]:
    if input.website_reachable is False:
        findings = [
            Finding(
                category="availability",
                severity="critical",
                message="The website did not load during research — visitors likely hit the same failure.",
                evidence=input.research_error or "Website did not load",
                confidence=1.0,
            )
        ]
        # A page that never loaded can't honestly be assessed for
        # anything else — HTTPS, mobile, contact paths, all unknown.
        return AgentResult(
            output=WebsiteQualityOutput(findings=findings, summary=_summarize(findings)),
            confidence=1.0,
            flagged_for_review=True,
            notes="Website was unreachable during research — audit limited to availability.",
        )

    if input.website_reachable is None:
        # No website URL on record at all — there's no page to check
        # HTTPS/mobile/title/etc against, so producing findings for
        # those would misreport "missing" page-level details on a page
        # that was never expected to exist. The absence of a website
        # entirely is opportunity_score.py's signal to weigh, not a
        # website-quality finding.
        return AgentResult(
            output=WebsiteQualityOutput(findings=[], summary="No website on record — nothing to audit."),
            confidence=1.0,
            notes="No website URL on record — quality analysis needs a page to inspect.",
        )

    findings: list[Finding] = []

    if input.https is False:
        findings.append(
            Finding(
                category="security",
                severity="high",
                message="The site is not served over HTTPS — most browsers show visitors a security warning.",
                evidence="Page loaded without HTTPS",
                confidence=1.0,
            )
        )

    if input.mobile_viewport_present is False:
        findings.append(
            Finding(
                category="mobile_usability",
                severity="high",
                message="No mobile viewport tag was found, so the site likely doesn't adapt to phone screens.",
                evidence='No <meta name="viewport"> tag found',
                confidence=0.85,
            )
        )

    if input.load_time_ms is not None:
        if input.load_time_ms > SLOW_LOAD_MS:
            findings.append(
                Finding(
                    category="performance",
                    severity="high",
                    message=f"The homepage took {input.load_time_ms}ms to load — slow enough that visitors may leave before it finishes.",
                    evidence=f"Measured load time: {input.load_time_ms}ms",
                    confidence=0.9,
                )
            )
        elif input.load_time_ms > MODERATE_LOAD_MS:
            findings.append(
                Finding(
                    category="performance",
                    severity="medium",
                    message=f"The homepage took {input.load_time_ms}ms to load — noticeably slower than a well-optimized site.",
                    evidence=f"Measured load time: {input.load_time_ms}ms",
                    confidence=0.9,
                )
            )

    if input.contact_cta_present is False:
        findings.append(
            Finding(
                category="conversion_path",
                severity="high",
                message="No clear way for a visitor to get in touch was found — no phone/email link or contact form.",
                evidence="No mailto/tel link or <form> found on the page",
                confidence=0.8,
            )
        )

    if not input.page_title:
        findings.append(
            Finding(
                category="business_information",
                severity="medium",
                message="The page has no title — this also hurts how the business shows up in search results.",
                evidence="No <title> content found",
                confidence=0.95,
            )
        )

    if not input.meta_description:
        findings.append(
            Finding(
                category="business_information",
                severity="low",
                message="The page has no meta description, which search engines use for the result snippet.",
                evidence="No meta description found",
                confidence=0.95,
            )
        )

    if input.appears_template_or_placeholder:
        findings.append(
            Finding(
                category="visual_structure",
                severity="medium",
                message="Placeholder or unfinished content is still visible on the live page.",
                evidence="Placeholder text (e.g. 'lorem ipsum') found on the page",
                confidence=0.9,
            )
        )

    return AgentResult(output=WebsiteQualityOutput(findings=findings, summary=_summarize(findings)))
