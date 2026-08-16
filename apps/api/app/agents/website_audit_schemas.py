"""
Structured output for the website-audit engine (app/agents/website_audit.py).

Every `Finding` is explicitly tagged VERIFIED_FACT / INFERENCE /
SUBJECTIVE_OBSERVATION per the operator's requirement — this is the
mechanism that keeps directly-measured data (e.g. "HTTPS: yes"),
heuristic conclusions (e.g. "no media queries found in linked CSS —
site may not be responsive"), and genuinely subjective calls (e.g.
"visual design reads as templated") from being presented with the same
confidence. Nothing in this module is ever populated with a guessed or
fabricated value — a field the engine couldn't reliably determine stays
`None`/empty rather than being filled in.
"""

import enum

from pydantic import BaseModel, Field


class FindingKind(str, enum.Enum):
    VERIFIED_FACT = "verified_fact"
    INFERENCE = "inference"
    SUBJECTIVE_OBSERVATION = "subjective_observation"


class AuditCategory(str, enum.Enum):
    TECHNICAL = "technical"
    SEO = "seo"
    PERFORMANCE = "performance"
    MOBILE = "mobile"
    ACCESSIBILITY = "accessibility"
    CONVERSION = "conversion"
    DESIGN = "design"


class Finding(BaseModel):
    category: AuditCategory
    kind: FindingKind
    label: str
    detail: str | None = None


class TechnicalResult(BaseModel):
    http_status: int | None = None
    page_title: str | None = None
    meta_description: str | None = None
    viewport: str | None = None
    https: bool | None = None
    detected_technologies: list[str] = Field(default_factory=list)
    broken_resources: list[str] = Field(default_factory=list)


class SeoResult(BaseModel):
    title: str | None = None
    description: str | None = None
    heading_counts: dict[str, int] = Field(default_factory=dict)
    h1_texts: list[str] = Field(default_factory=list)
    canonical_url: str | None = None
    sitemap_found: bool | None = None
    robots_found: bool | None = None
    robots_disallows_all: bool | None = None
    lang: str | None = None
    og_title: str | None = None
    og_description: str | None = None


class PerformanceResult(BaseModel):
    page_size_bytes: int | None = None
    resource_counts: dict[str, int] = Field(default_factory=dict)
    large_images: list[str] = Field(default_factory=list)
    render_blocking_scripts: int | None = None
    heuristic_speed_score: int | None = None


class MobileResult(BaseModel):
    viewport_present: bool | None = None
    viewport_content: str | None = None
    media_query_count: int | None = None


class AccessibilityResult(BaseModel):
    images_total: int | None = None
    images_missing_alt: int | None = None
    missing_alt_examples: list[str] = Field(default_factory=list)
    heading_structure_ok: bool | None = None
    heading_issues: list[str] = Field(default_factory=list)
    inputs_missing_labels: int | None = None


class ConversionResult(BaseModel):
    cta_texts_found: list[str] = Field(default_factory=list)
    phone_numbers_found: list[str] = Field(default_factory=list)
    contact_links: list[str] = Field(default_factory=list)
    contact_form_present: bool | None = None


class DesignResult(BaseModel):
    distinct_font_families: int | None = None
    uses_css_framework: str | None = None
    outdated_signals: list[str] = Field(default_factory=list)


class WebsiteAuditOutput(BaseModel):
    url: str
    final_url: str | None = None
    reachable: bool
    blocked: bool | None = None  # True if rejected by SSRF protection, False if an ordinary fetch failure
    block_reason: str | None = None
    technical: TechnicalResult = Field(default_factory=TechnicalResult)
    seo: SeoResult = Field(default_factory=SeoResult)
    performance: PerformanceResult = Field(default_factory=PerformanceResult)
    mobile: MobileResult = Field(default_factory=MobileResult)
    accessibility: AccessibilityResult = Field(default_factory=AccessibilityResult)
    conversion: ConversionResult = Field(default_factory=ConversionResult)
    design: DesignResult = Field(default_factory=DesignResult)
    findings: list[Finding] = Field(default_factory=list)
    report_markdown: str = ""


class WebsiteAuditInput(BaseModel):
    url: str
