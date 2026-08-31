"""
Business research role — docs/04_ROADMAP.md Lead Intelligence stage 2.
Deterministic, no LLM call, same approach as agents/website_audit.py:
drives integrations/browser.py and maps its real, measured signals onto
BusinessResearchAgentOutput. Never invents a value a signal didn't
actually provide — every finding lands in exactly one of
confirmed_facts (directly observed), inferred_facts (a reasonable read
on ambiguous evidence, always caveated), or unavailable_fields
(genuinely couldn't be determined), per the "confirmed vs inferred vs
unavailable" requirement.
"""

import asyncio
import re
from datetime import datetime, timezone

from pydantic import BaseModel

from app.agents.base import AgentResult
from app.integrations.browser import fetch_research_signals

_PLACEHOLDER_NEEDLES = (
    "lorem ipsum",
    "your company name",
    "your business name",
    "sample text",
    "placeholder text",
    "this is a sample",
)
_COPYRIGHT_RE = re.compile(r"(?:©|\(c\)|copyright)\s*(\d{4})", re.IGNORECASE)


class BusinessResearchAgentInput(BaseModel):
    website_url: str | None


class BusinessResearchAgentOutput(BaseModel):
    official_website_url: str | None = None
    website_reachable: bool | None = None
    https: bool | None = None
    http_status: int | None = None
    page_title: str | None = None
    meta_description: str | None = None
    mobile_viewport_present: bool | None = None
    contact_cta_present: bool | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    load_time_ms: int | None = None
    estimated_site_age: str | None = None
    appears_template_or_placeholder: bool | None = None
    # A postal address / map coordinates the site publishes about itself
    # in schema.org markup — directly observed, never geocoded or guessed.
    postal_address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    technical_issues: list[str] = []
    social_presence: list[str] = []
    confirmed_facts: list[str] = []
    inferred_facts: list[str] = []
    unavailable_fields: list[str] = []
    research_error: str | None = None


_NO_WEBSITE_UNAVAILABLE = [
    "Website reachability",
    "HTTPS status",
    "Page metadata",
    "Mobile viewport",
    "Contact/CTA presence",
    "Website age",
    "Template/placeholder status",
    "Social presence",
]


def _find_copyright_year(body_text: str | None) -> int | None:
    if not body_text:
        return None
    match = _COPYRIGHT_RE.search(body_text)
    if not match:
        return None
    year = int(match.group(1))
    current_year = datetime.now(timezone.utc).year
    # A copyright year outside a sane range is more likely a mismatched
    # regex hit (a phone number, an unrelated 4-digit string) than a
    # real copyright notice — treat it as not found rather than reporting
    # a nonsensical age.
    if 1995 <= year <= current_year:
        return year
    return None


def _find_placeholder_text(body_text: str | None) -> bool:
    if not body_text:
        return False
    lowered = body_text.lower()
    return any(needle in lowered for needle in _PLACEHOLDER_NEEDLES)


def run(input: BusinessResearchAgentInput) -> AgentResult[BusinessResearchAgentOutput]:
    if not input.website_url:
        return AgentResult(
            output=BusinessResearchAgentOutput(
                confirmed_facts=["No website URL on record"],
                unavailable_fields=list(_NO_WEBSITE_UNAVAILABLE),
            ),
            confidence=1.0,
            notes="No website URL on record — nothing to research.",
        )

    signals = asyncio.run(fetch_research_signals(input.website_url))

    if signals.error:
        return AgentResult(
            output=BusinessResearchAgentOutput(
                official_website_url=input.website_url,
                website_reachable=False,
                research_error=signals.error,
                confirmed_facts=[f"Website could not be loaded: {signals.error}"],
                unavailable_fields=[f for f in _NO_WEBSITE_UNAVAILABLE if f != "Website reachability"],
            ),
            confidence=0.4,
            flagged_for_review=True,
            notes=f"Could not load {input.website_url}: {signals.error}",
        )

    confirmed: list[str] = [f"Website reachable at {signals.final_url or input.website_url}"]
    inferred: list[str] = []
    unavailable: list[str] = []
    technical_issues: list[str] = []

    confirmed.append(f"HTTPS: {'yes' if signals.https else 'no'}")
    if signals.https is False:
        technical_issues.append("Not served over HTTPS")

    if signals.title:
        confirmed.append(f"Page title: {signals.title!r}")
    else:
        unavailable.append("Page title")
        technical_issues.append("Missing page title")

    if signals.meta_description:
        confirmed.append("Meta description present")
    else:
        unavailable.append("Meta description")
        technical_issues.append("Missing meta description")

    if signals.viewport_meta_present is not None:
        confirmed.append(f"Mobile viewport tag {'present' if signals.viewport_meta_present else 'absent'}")
        if not signals.viewport_meta_present:
            technical_issues.append("No mobile viewport tag")
    else:
        unavailable.append("Mobile viewport tag")

    if signals.mobile_overflow:
        technical_issues.append("Content overflows at mobile width")

    if signals.contact_cta_present is not None:
        confirmed.append(
            "Contact path found (mailto/tel link or a form)"
            if signals.contact_cta_present
            else "No mailto/tel link or form found on the page"
        )
        if not signals.contact_cta_present:
            technical_issues.append("No obvious contact method (no mailto/tel link or form)")
    else:
        unavailable.append("Contact/CTA presence")

    if signals.contact_phone:
        confirmed.append(f"Phone on the website: {signals.contact_phone}")
    if signals.contact_email:
        confirmed.append(f"Email on the website: {signals.contact_email}")

    if signals.postal_address:
        confirmed.append(f"Address in the site's schema.org markup: {signals.postal_address}")
    if signals.latitude is not None and signals.longitude is not None:
        confirmed.append(
            f"Map coordinates published on the site: {signals.latitude:.5f}, {signals.longitude:.5f}"
        )

    social_links = signals.social_links or []
    if social_links:
        confirmed.append(f"{len(social_links)} social media link(s) found on the page")
    else:
        unavailable.append("Social media presence (none found on the page — may still exist elsewhere)")

    if signals.load_time_ms is not None:
        confirmed.append(f"Page load time: {signals.load_time_ms}ms")
    else:
        unavailable.append("Page load time")

    estimated_site_age = None
    copyright_year = _find_copyright_year(signals.body_text)
    if copyright_year is not None:
        current_year = datetime.now(timezone.utc).year
        age_years = current_year - copyright_year
        confirmed.append(f"Copyright year {copyright_year} found on the page")
        estimated_site_age = (
            f"At least {age_years} year(s) old" if age_years > 0 else "Content copyrighted this year"
        ) + f" — based on a copyright year ({copyright_year}) found in the page text; the site's actual design could be older or newer than its content"
        inferred.append(estimated_site_age)
    else:
        unavailable.append("Website age (no copyright year found in the page text)")

    # Only a positive finding here: literal placeholder text left on a
    # live page is unambiguous evidence. Its *absence* proves nothing —
    # a real, finished site and one we simply didn't spot placeholder
    # text on look identical from this one signal, so appears_template_
    # or_placeholder stays None (undetermined) rather than False.
    appears_template_or_placeholder = None
    if _find_placeholder_text(signals.body_text):
        confirmed.append("Placeholder text found on the page (e.g. 'lorem ipsum' or similar)")
        appears_template_or_placeholder = True
        technical_issues.append("Placeholder/unfinished content found on a live page")

    if signals.generator_meta:
        inferred.append(f"Site appears to be built with {signals.generator_meta} (per generator meta tag)")

    output = BusinessResearchAgentOutput(
        official_website_url=signals.final_url or input.website_url,
        website_reachable=True,
        https=signals.https,
        http_status=signals.http_status,
        page_title=signals.title,
        meta_description=signals.meta_description,
        mobile_viewport_present=signals.viewport_meta_present,
        contact_cta_present=signals.contact_cta_present,
        contact_phone=signals.contact_phone,
        contact_email=signals.contact_email,
        load_time_ms=signals.load_time_ms,
        estimated_site_age=estimated_site_age,
        appears_template_or_placeholder=appears_template_or_placeholder,
        postal_address=signals.postal_address,
        latitude=signals.latitude,
        longitude=signals.longitude,
        technical_issues=technical_issues,
        social_presence=social_links,
        confirmed_facts=confirmed,
        inferred_facts=inferred,
        unavailable_fields=unavailable,
    )
    return AgentResult(output=output, confidence=0.85)
