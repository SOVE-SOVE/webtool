"""
Website auditing role — docs/02_ARCHITECTURE.md §6, roadmap M2.
Deterministic: drives integrations/browser.py and maps its real,
measured signals onto WebsiteAudit's fields. Makes no LLM call, but
still returns the shared AgentResult shape for consistency with every
other agent and so callers can rely on flagged_for_review uniformly.
"""

import asyncio

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.browser import fetch_page_signals


class WebsiteAuditInput(BaseModel):
    website_url: str | None


class WebsiteAuditOutput(BaseModel):
    has_existing_site: bool
    mobile_friendly: bool | None = None
    https: bool | None = None
    load_time_ms: int | None = None
    title: str | None = None
    meta_description: str | None = None
    viewport_meta_present: bool | None = None
    audit_error: str | None = None


def run(input: WebsiteAuditInput) -> AgentResult[WebsiteAuditOutput]:
    if not input.website_url:
        return AgentResult(
            output=WebsiteAuditOutput(has_existing_site=False),
            confidence=1.0,
            notes="No website URL on record — nothing to audit.",
        )

    signals = asyncio.run(fetch_page_signals(input.website_url))

    if signals.error:
        return AgentResult(
            output=WebsiteAuditOutput(has_existing_site=True, audit_error=signals.error),
            confidence=0.3,
            flagged_for_review=True,
            notes=f"Could not load {input.website_url}: {signals.error}",
        )

    # A page can have no <meta name="viewport"> and still not overflow at
    # mobile width (e.g. a very simple layout) — only call it "not
    # mobile-friendly" when both signals actually point that way, not
    # when either read is ambiguous.
    mobile_friendly = None
    if signals.viewport_meta_present is not None and signals.mobile_overflow is not None:
        mobile_friendly = bool(signals.viewport_meta_present) and not signals.mobile_overflow

    output = WebsiteAuditOutput(
        has_existing_site=True,
        mobile_friendly=mobile_friendly,
        https=signals.https,
        load_time_ms=signals.load_time_ms,
        title=signals.title,
        meta_description=signals.meta_description,
        viewport_meta_present=signals.viewport_meta_present,
    )
    return AgentResult(output=output, confidence=0.9)
