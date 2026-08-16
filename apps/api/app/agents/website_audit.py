"""
Website audit engine — stage 3 (WEBSITE AUDIT) of the pipeline in
docs/00_VISION.md. Given a lead's website URL, fetches and statically
analyzes what can be reliably measured without executing JavaScript or
rendering the page: HTML structure, linked resources, headers, and
robots/sitemap files. See docs/05_DECISIONS.md for why this version is
static-analysis-only (no Playwright/rendering) and what that trades off.

Every outbound fetch goes through app.integrations.safe_http, which is
SSRF-safe — the target URL is untrusted input from a lead record.

Nothing here is fabricated: a data point the engine can't reliably
determine is left absent rather than guessed. See
website_audit_schemas.py for the VERIFIED_FACT / INFERENCE /
SUBJECTIVE_OBSERVATION distinction every finding carries.
"""

import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, Tag

from app.agents.base import AgentResult
from app.agents.website_audit_schemas import (
    AccessibilityResult,
    AuditCategory,
    ConversionResult,
    DesignResult,
    Finding,
    FindingKind,
    MobileResult,
    PerformanceResult,
    SeoResult,
    TechnicalResult,
    WebsiteAuditInput,
    WebsiteAuditOutput,
)
from app.integrations.safe_http import AuditFetchError, SafeResponse, SSRFBlockedError, safe_fetch, safe_head

MAX_RESOURCE_CHECKS = 8
MAX_CSS_FETCHES = 2
MAX_IMAGE_SIZE_CHECKS = 5
LARGE_IMAGE_BYTES = 500_000  # 500KB — a reasonable "this is probably unoptimized" threshold

CTA_PHRASES = [
    "get a quote", "get quote", "free quote", "request a quote", "contact us",
    "book now", "call now", "get started", "enquire now", "enquiry", "book a",
    "schedule", "learn more", "buy now", "shop now", "get in touch", "reach out",
    "sign up", "subscribe", "order now",
]

TECH_SIGNATURES = [
    ("WordPress", ["wp-content", "wp-includes"]),
    ("Shopify", ["cdn.shopify.com", "Shopify.theme"]),
    ("Wix", ["static.wixstatic.com", "wix.com"]),
    ("Squarespace", ["static1.squarespace.com", "squarespace.com"]),
    ("Webflow", ["webflow.com", "js-webflow"]),
    ("Next.js", ["__NEXT_DATA__", "_next/static"]),
    ("React", ["data-reactroot", "react-dom"]),
    ("Bootstrap", ["bootstrap.min.css", "bootstrap.min.js"]),
]

PHONE_RE = re.compile(r"(?:\+?\d[\d\-.\s()]{7,18}\d)")
STATIC_LAYOUT_TAGS = {"marquee", "blink"}


def run(audit_input: WebsiteAuditInput) -> AgentResult[WebsiteAuditOutput]:
    url = audit_input.url
    findings: list[Finding] = []

    try:
        response = safe_fetch(url)
    except SSRFBlockedError as exc:
        return _unreachable_result(url, reason=str(exc), blocked=True)
    except AuditFetchError as exc:
        return _unreachable_result(url, reason=str(exc), blocked=False)

    findings.append(
        Finding(
            category=AuditCategory.TECHNICAL,
            kind=FindingKind.VERIFIED_FACT,
            label=f"Site responded with HTTP {response.status_code}",
        )
    )

    content_type = response.headers.get("content-type", "")
    if "html" not in content_type.lower():
        findings.append(
            Finding(
                category=AuditCategory.TECHNICAL,
                kind=FindingKind.VERIFIED_FACT,
                label=f"Response content-type was '{content_type or 'unknown'}', not HTML",
                detail="Most checks below require an HTML page and were skipped.",
            )
        )
        output = WebsiteAuditOutput(
            url=url,
            final_url=response.final_url,
            reachable=True,
            technical=TechnicalResult(http_status=response.status_code, https=response.final_url.startswith("https://")),
            findings=findings,
        )
        output.report_markdown = _build_report(output)
        return AgentResult(output=output, flagged_for_review=True, notes="Response was not HTML")

    soup = BeautifulSoup(response.text, "html.parser")

    technical, technical_findings = _analyze_technical(response, soup)
    seo, seo_findings = _analyze_seo(response, soup)
    conversion, conversion_findings = _analyze_conversion(soup)
    accessibility, accessibility_findings = _analyze_accessibility(soup)
    mobile, css_texts, mobile_findings = _analyze_mobile(response, soup)
    design, design_findings = _analyze_design(soup, css_texts)
    performance, performance_findings = _analyze_performance(response, soup)

    findings += technical_findings + seo_findings + performance_findings
    findings += mobile_findings + accessibility_findings + conversion_findings + design_findings

    flagged = technical.http_status is not None and technical.http_status >= 400

    output = WebsiteAuditOutput(
        url=url,
        final_url=response.final_url,
        reachable=True,
        technical=technical,
        seo=seo,
        performance=performance,
        mobile=mobile,
        accessibility=accessibility,
        conversion=conversion,
        design=design,
        findings=findings,
    )
    output.report_markdown = _build_report(output)

    return AgentResult(
        output=output,
        flagged_for_review=flagged,
        notes=f"Site returned HTTP {technical.http_status}" if flagged else None,
    )


def _unreachable_result(url: str, *, reason: str, blocked: bool) -> AgentResult[WebsiteAuditOutput]:
    label = "Site could not be safely audited" if blocked else "Site could not be reached"
    output = WebsiteAuditOutput(
        url=url,
        reachable=False,
        blocked=blocked,
        block_reason=reason,
        findings=[
            Finding(
                category=AuditCategory.TECHNICAL,
                kind=FindingKind.VERIFIED_FACT,
                label=label,
                detail=reason,
            )
        ],
    )
    output.report_markdown = _build_report(output)
    return AgentResult(output=output, flagged_for_review=True, notes=reason)


# --- Technical ---------------------------------------------------------------


def _analyze_technical(response: SafeResponse, soup: BeautifulSoup) -> tuple[TechnicalResult, list[Finding]]:
    findings: list[Finding] = []
    title_tag = soup.find("title")
    page_title = title_tag.get_text(strip=True) if title_tag else None

    meta_desc = _meta_content(soup, "description")
    viewport = _meta_content(soup, "viewport")
    https = response.final_url.startswith("https://")

    findings.append(
        Finding(
            category=AuditCategory.TECHNICAL,
            kind=FindingKind.VERIFIED_FACT,
            label="Site is served over HTTPS" if https else "Site is not served over HTTPS",
        )
    )
    if not page_title:
        findings.append(
            Finding(
                category=AuditCategory.TECHNICAL,
                kind=FindingKind.VERIFIED_FACT,
                label="Page has no <title> element",
            )
        )

    technologies = _detect_technologies(response, soup)
    if technologies:
        findings.append(
            Finding(
                category=AuditCategory.TECHNICAL,
                kind=FindingKind.INFERENCE,
                label=f"Detected technology signatures: {', '.join(technologies)}",
                detail="Based on known markup/URL patterns, not a full fingerprint.",
            )
        )

    broken = _check_broken_resources(response, soup)
    for resource_url in broken:
        findings.append(
            Finding(
                category=AuditCategory.TECHNICAL,
                kind=FindingKind.VERIFIED_FACT,
                label="Broken resource",
                detail=resource_url,
            )
        )

    result = TechnicalResult(
        http_status=response.status_code,
        page_title=page_title,
        meta_description=meta_desc,
        viewport=viewport,
        https=https,
        detected_technologies=technologies,
        broken_resources=broken,
    )
    return result, findings


def _meta_content(soup: BeautifulSoup, name: str) -> str | None:
    tag = soup.find("meta", attrs={"name": name})
    if isinstance(tag, Tag):
        content = tag.get("content")
        return content.strip() if isinstance(content, str) else None
    return None


def _meta_property(soup: BeautifulSoup, prop: str) -> str | None:
    tag = soup.find("meta", attrs={"property": prop})
    if isinstance(tag, Tag):
        content = tag.get("content")
        return content.strip() if isinstance(content, str) else None
    return None


def _detect_technologies(response: SafeResponse, soup: BeautifulSoup) -> list[str]:
    haystack = response.text
    found = []
    for name, signatures in TECH_SIGNATURES:
        if any(sig in haystack for sig in signatures):
            found.append(name)

    server = response.headers.get("server")
    if server:
        found.append(f"Server: {server}")
    powered_by = response.headers.get("x-powered-by")
    if powered_by:
        found.append(f"X-Powered-By: {powered_by}")

    generator = _meta_content(soup, "generator")
    if generator:
        found.append(f"Generator: {generator}")

    return found


def _resource_urls(soup: BeautifulSoup, base_url: str) -> list[str]:
    urls: list[str] = []
    for img in soup.find_all("img"):
        src = img.get("src") if isinstance(img, Tag) else None
        if src:
            urls.append(urljoin(base_url, src))
    for link in soup.find_all("link", rel="stylesheet"):
        href = link.get("href") if isinstance(link, Tag) else None
        if href:
            urls.append(urljoin(base_url, href))
    for script in soup.find_all("script", src=True):
        src = script.get("src") if isinstance(script, Tag) else None
        if src:
            urls.append(urljoin(base_url, src))
    return urls


def _check_broken_resources(response: SafeResponse, soup: BeautifulSoup) -> list[str]:
    urls = _resource_urls(soup, response.final_url)[:MAX_RESOURCE_CHECKS]
    broken = []
    for resource_url in urls:
        try:
            head = safe_head(resource_url, timeout=5)
            if head.status_code >= 400:
                broken.append(resource_url)
        except (SSRFBlockedError, AuditFetchError):
            broken.append(resource_url)
    return broken


# --- SEO -----------------------------------------------------------------


def _analyze_seo(response: SafeResponse, soup: BeautifulSoup) -> tuple[SeoResult, list[Finding]]:
    findings: list[Finding] = []
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else None
    description = _meta_content(soup, "description")

    heading_counts = {f"h{n}": len(soup.find_all(f"h{n}")) for n in range(1, 7)}
    h1_texts = [h.get_text(strip=True) for h in soup.find_all("h1")]

    canonical_tag = soup.find("link", rel="canonical")
    canonical_url = canonical_tag.get("href") if isinstance(canonical_tag, Tag) else None

    html_tag = soup.find("html")
    lang = html_tag.get("lang") if isinstance(html_tag, Tag) else None

    sitemap_found = _check_well_known(response.final_url, "/sitemap.xml")
    robots_text = _fetch_well_known_text(response.final_url, "/robots.txt")
    robots_found = robots_text is not None
    robots_disallows_all = (
        bool(re.search(r"user-agent:\s*\*\s*\n\s*disallow:\s*/\s*$", robots_text, re.IGNORECASE | re.MULTILINE))
        if robots_text
        else None
    )

    if not title:
        findings.append(Finding(category=AuditCategory.SEO, kind=FindingKind.VERIFIED_FACT, label="No <title> element"))
    elif len(title) > 60:
        findings.append(
            Finding(
                category=AuditCategory.SEO,
                kind=FindingKind.INFERENCE,
                label=f"Title is {len(title)} characters — may be truncated in search results",
                detail=title,
            )
        )
    if not description:
        findings.append(
            Finding(category=AuditCategory.SEO, kind=FindingKind.VERIFIED_FACT, label="No meta description")
        )
    if heading_counts["h1"] == 0:
        findings.append(Finding(category=AuditCategory.SEO, kind=FindingKind.VERIFIED_FACT, label="No <h1> on the page"))
    elif heading_counts["h1"] > 1:
        findings.append(
            Finding(
                category=AuditCategory.SEO,
                kind=FindingKind.INFERENCE,
                label=f"Page has {heading_counts['h1']} <h1> elements — usually should be exactly one",
            )
        )
    if not canonical_url:
        findings.append(
            Finding(category=AuditCategory.SEO, kind=FindingKind.VERIFIED_FACT, label="No canonical link tag")
        )
    if sitemap_found is False:
        findings.append(
            Finding(category=AuditCategory.SEO, kind=FindingKind.VERIFIED_FACT, label="No sitemap.xml found at the root")
        )
    if robots_found is False:
        findings.append(
            Finding(category=AuditCategory.SEO, kind=FindingKind.VERIFIED_FACT, label="No robots.txt found at the root")
        )
    if robots_disallows_all:
        findings.append(
            Finding(
                category=AuditCategory.SEO,
                kind=FindingKind.VERIFIED_FACT,
                label="robots.txt disallows all crawlers (Disallow: /)",
            )
        )

    result = SeoResult(
        title=title,
        description=description,
        heading_counts=heading_counts,
        h1_texts=h1_texts[:5],
        canonical_url=canonical_url,
        sitemap_found=sitemap_found,
        robots_found=robots_found,
        robots_disallows_all=robots_disallows_all,
        lang=lang,
        og_title=_meta_property(soup, "og:title"),
        og_description=_meta_property(soup, "og:description"),
    )
    return result, findings


def _check_well_known(base_url: str, path: str) -> bool | None:
    try:
        response = safe_head(urljoin(base_url, path), timeout=5)
        return response.status_code < 400
    except (SSRFBlockedError, AuditFetchError):
        return None


def _fetch_well_known_text(base_url: str, path: str) -> str | None:
    try:
        response = safe_fetch(urljoin(base_url, path), timeout=5)
        return response.text if response.status_code < 400 else None
    except (SSRFBlockedError, AuditFetchError):
        return None


# --- Performance -----------------------------------------------------------


def _analyze_performance(response: SafeResponse, soup: BeautifulSoup) -> tuple[PerformanceResult, list[Finding]]:
    findings: list[Finding] = []
    page_size = len(response.content)

    resource_counts = {
        "images": len(soup.find_all("img")),
        "scripts": len(soup.find_all("script", src=True)),
        "stylesheets": len(soup.find_all("link", rel="stylesheet")),
    }

    head = soup.find("head")
    render_blocking = 0
    if isinstance(head, Tag):
        render_blocking = len(
            [s for s in head.find_all("script", src=True) if not s.has_attr("async") and not s.has_attr("defer")]
        )

    large_images = _check_large_images(response.final_url, soup)

    if page_size > 2_000_000:
        findings.append(
            Finding(
                category=AuditCategory.PERFORMANCE,
                kind=FindingKind.INFERENCE,
                label=f"HTML document is {page_size // 1024}KB — unusually large for a single page",
            )
        )
    if render_blocking > 3:
        findings.append(
            Finding(
                category=AuditCategory.PERFORMANCE,
                kind=FindingKind.INFERENCE,
                label=f"{render_blocking} scripts in <head> without async/defer — likely render-blocking",
            )
        )
    for img_url in large_images:
        findings.append(
            Finding(
                category=AuditCategory.PERFORMANCE,
                kind=FindingKind.VERIFIED_FACT,
                label=f"Image over {LARGE_IMAGE_BYTES // 1000}KB",
                detail=img_url,
            )
        )

    score = _heuristic_speed_score(page_size, resource_counts, len(large_images))
    findings.append(
        Finding(
            category=AuditCategory.PERFORMANCE,
            kind=FindingKind.INFERENCE,
            label=f"Heuristic speed score: {score}/100",
            detail="Estimated from page size, resource counts, and image sizes — not a real Lighthouse/PageSpeed run.",
        )
    )

    result = PerformanceResult(
        page_size_bytes=page_size,
        resource_counts=resource_counts,
        large_images=large_images,
        render_blocking_scripts=render_blocking,
        heuristic_speed_score=score,
    )
    return result, findings


def _check_large_images(base_url: str, soup: BeautifulSoup) -> list[str]:
    urls = []
    for img in soup.find_all("img")[:MAX_IMAGE_SIZE_CHECKS]:
        src = img.get("src") if isinstance(img, Tag) else None
        if src:
            urls.append(urljoin(base_url, src))

    large = []
    for img_url in urls:
        try:
            head = safe_head(img_url, timeout=5)
            length = head.headers.get("content-length")
            if length and int(length) > LARGE_IMAGE_BYTES:
                large.append(img_url)
        except (SSRFBlockedError, AuditFetchError, ValueError):
            continue
    return large


def _heuristic_speed_score(page_size: int, resource_counts: dict[str, int], large_image_count: int) -> int:
    score = 100
    if page_size > 100_000:
        score -= min(30, (page_size - 100_000) // 50_000 * 5)
    total_resources = sum(resource_counts.values())
    if total_resources > 20:
        score -= min(30, (total_resources - 20) * 2)
    score -= large_image_count * 10
    return max(0, min(100, score))


# --- Mobile ------------------------------------------------------------------


def _analyze_mobile(response: SafeResponse, soup: BeautifulSoup) -> tuple[MobileResult, list[str], list[Finding]]:
    findings: list[Finding] = []
    viewport = _meta_content(soup, "viewport")

    css_texts = [style.get_text() for style in soup.find_all("style")]
    css_texts += _fetch_linked_css(response.final_url, soup)

    media_query_count = sum(len(re.findall(r"@media", css)) for css in css_texts)

    if not viewport:
        findings.append(
            Finding(
                category=AuditCategory.MOBILE,
                kind=FindingKind.VERIFIED_FACT,
                label="No viewport meta tag — page likely isn't mobile-optimized",
            )
        )
    elif "width=device-width" not in viewport.replace(" ", ""):
        findings.append(
            Finding(
                category=AuditCategory.MOBILE,
                kind=FindingKind.INFERENCE,
                label="Viewport meta tag doesn't set width=device-width",
                detail=viewport,
            )
        )
    if css_texts and media_query_count == 0:
        findings.append(
            Finding(
                category=AuditCategory.MOBILE,
                kind=FindingKind.INFERENCE,
                label="No @media queries found in inline or linked CSS — page may not adapt to smaller screens",
                detail="Weak signal: some responsive sites use very few or no media queries by design.",
            )
        )

    result = MobileResult(
        viewport_present=viewport is not None,
        viewport_content=viewport,
        media_query_count=media_query_count,
    )
    return result, css_texts, findings


def _fetch_linked_css(base_url: str, soup: BeautifulSoup) -> list[str]:
    hrefs = []
    for link in soup.find_all("link", rel="stylesheet"):
        href = link.get("href") if isinstance(link, Tag) else None
        if href:
            hrefs.append(urljoin(base_url, href))

    texts = []
    for href in hrefs[:MAX_CSS_FETCHES]:
        try:
            response = safe_fetch(href, timeout=5)
            texts.append(response.text)
        except (SSRFBlockedError, AuditFetchError):
            continue
    return texts


# --- Accessibility -----------------------------------------------------------


def _analyze_accessibility(soup: BeautifulSoup) -> tuple[AccessibilityResult, list[Finding]]:
    findings: list[Finding] = []
    images = soup.find_all("img")
    missing_alt = [img for img in images if not img.get("alt")]
    missing_alt_srcs = [img.get("src", "") for img in missing_alt[:5]]

    heading_issues = []
    counts = {n: len(soup.find_all(f"h{n}")) for n in range(1, 7)}
    if counts[1] == 0:
        heading_issues.append("No <h1> found")
    highest_present = max([n for n, c in counts.items() if c > 0], default=0)
    for n in range(2, highest_present + 1):
        if counts[n] == 0 and any(counts[m] > 0 for m in range(n + 1, 7)):
            heading_issues.append(f"Heading level h{n} is skipped")

    inputs = soup.find_all("input")
    labeled_ids = {label.get("for") for label in soup.find_all("label") if label.get("for")}
    unlabeled_inputs = 0
    for inp in inputs:
        input_type = inp.get("type", "text")
        if input_type in ("hidden", "submit", "button"):
            continue
        has_label = (inp.get("id") in labeled_ids) or inp.get("aria-label") or inp.get("aria-labelledby")
        if not has_label:
            unlabeled_inputs += 1

    if missing_alt:
        findings.append(
            Finding(
                category=AuditCategory.ACCESSIBILITY,
                kind=FindingKind.VERIFIED_FACT,
                label=f"{len(missing_alt)} of {len(images)} images have no alt attribute",
            )
        )
    for issue in heading_issues:
        findings.append(Finding(category=AuditCategory.ACCESSIBILITY, kind=FindingKind.VERIFIED_FACT, label=issue))
    if unlabeled_inputs:
        findings.append(
            Finding(
                category=AuditCategory.ACCESSIBILITY,
                kind=FindingKind.VERIFIED_FACT,
                label=f"{unlabeled_inputs} form input(s) with no associated label",
            )
        )
    findings.append(
        Finding(
            category=AuditCategory.ACCESSIBILITY,
            kind=FindingKind.SUBJECTIVE_OBSERVATION,
            label="Color contrast not evaluated",
            detail="Contrast requires rendering computed styles, which this version doesn't do — not reliably measurable from static HTML.",
        )
    )

    result = AccessibilityResult(
        images_total=len(images),
        images_missing_alt=len(missing_alt),
        missing_alt_examples=missing_alt_srcs,
        heading_structure_ok=len(heading_issues) == 0,
        heading_issues=heading_issues,
        inputs_missing_labels=unlabeled_inputs,
    )
    return result, findings


# --- Conversion ----------------------------------------------------------


def _analyze_conversion(soup: BeautifulSoup) -> tuple[ConversionResult, list[Finding]]:
    findings: list[Finding] = []
    clickable_texts = [el.get_text(strip=True) for el in soup.find_all(["a", "button"])]
    cta_found = sorted(
        {phrase for phrase in CTA_PHRASES for text in clickable_texts if phrase in text.lower()}
    )

    contact_links = []
    phone_numbers = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("tel:"):
            contact_links.append(href)
            phone_numbers.add(href.removeprefix("tel:"))
        elif href.startswith("mailto:"):
            contact_links.append(href)

    body_text = soup.get_text(" ")
    for match in PHONE_RE.findall(body_text):
        digits = re.sub(r"\D", "", match)
        if 8 <= len(digits) <= 12:
            phone_numbers.add(match.strip())

    contact_form = any(
        isinstance(form, Tag)
        and (
            form.find("input", attrs={"type": "email"})
            or form.find("textarea")
            or any(
                keyword in (inp.get("name", "") + inp.get("id", "")).lower()
                for inp in form.find_all("input")
                for keyword in ("email", "phone", "message", "contact", "name")
            )
        )
        for form in soup.find_all("form")
    )

    if not cta_found:
        findings.append(
            Finding(
                category=AuditCategory.CONVERSION,
                kind=FindingKind.INFERENCE,
                label="No common call-to-action phrasing found on the page",
                detail="Checked link/button text against a list of common CTA phrases — a custom-worded CTA could still be present.",
            )
        )
    if not contact_links and not phone_numbers:
        findings.append(
            Finding(
                category=AuditCategory.CONVERSION,
                kind=FindingKind.VERIFIED_FACT,
                label="No tel:/mailto: links or phone number found",
            )
        )
    if not contact_form:
        findings.append(
            Finding(
                category=AuditCategory.CONVERSION,
                kind=FindingKind.INFERENCE,
                label="No obvious contact form found",
                detail="Checked for a <form> with email/message/contact-style fields.",
            )
        )
    if not cta_found and not contact_form and not contact_links:
        findings.append(
            Finding(
                category=AuditCategory.CONVERSION,
                kind=FindingKind.SUBJECTIVE_OBSERVATION,
                label="No obvious path for a visitor to get in touch or convert",
            )
        )

    result = ConversionResult(
        cta_texts_found=cta_found,
        phone_numbers_found=sorted(phone_numbers)[:5],
        contact_links=contact_links[:5],
        contact_form_present=contact_form,
    )
    return result, findings


# --- Design --------------------------------------------------------------


def _analyze_design(soup: BeautifulSoup, css_texts: list[str]) -> tuple[DesignResult, list[Finding]]:
    findings: list[Finding] = []
    combined_css = "\n".join(css_texts)
    font_families = set(re.findall(r"font-family:\s*([^;{}]+)", combined_css, re.IGNORECASE))
    font_count = len(font_families) if font_families else None

    framework = None
    if "bootstrap" in combined_css.lower():
        framework = "Bootstrap"
    elif re.search(r"\btailwind\b", combined_css, re.IGNORECASE):
        framework = "Tailwind"

    outdated = []
    jquery_match = re.search(r"jquery-1\.\d+", "\n".join(css_texts) + str(soup))
    if jquery_match:
        outdated.append("Uses a jQuery 1.x build (over a decade old)")
    if soup.find_all(list(STATIC_LAYOUT_TAGS)):
        outdated.append("Uses deprecated HTML tags (<marquee>/<blink>)")
    if soup.find_all("table", attrs={"width": True}) and soup.find("body") and not soup.find_all("div", class_=True):
        outdated.append("Page structure leans on table-based layout with almost no CSS classes")

    if font_count and font_count > 4:
        findings.append(
            Finding(
                category=AuditCategory.DESIGN,
                kind=FindingKind.SUBJECTIVE_OBSERVATION,
                label=f"{font_count} distinct font-family declarations found — may read as visually inconsistent",
            )
        )
    if framework:
        findings.append(
            Finding(
                category=AuditCategory.DESIGN,
                kind=FindingKind.INFERENCE,
                label=f"Site appears to use {framework}",
            )
        )
    for signal in outdated:
        findings.append(
            Finding(category=AuditCategory.DESIGN, kind=FindingKind.SUBJECTIVE_OBSERVATION, label=signal)
        )
    findings.append(
        Finding(
            category=AuditCategory.DESIGN,
            kind=FindingKind.SUBJECTIVE_OBSERVATION,
            label="Full visual/typography/spacing assessment not performed",
            detail="This version analyzes HTML/CSS statically and does not render or screenshot the page.",
        )
    )

    result = DesignResult(
        distinct_font_families=font_count,
        uses_css_framework=framework,
        outdated_signals=outdated,
    )
    return result, findings


# --- Report --------------------------------------------------------------


def _build_report(output: WebsiteAuditOutput) -> str:
    lines = [f"# Website audit: {output.url}", ""]

    if not output.reachable:
        lines.append(f"**Site could not be audited.** {output.block_reason or ''}")
        return "\n".join(lines)

    lines.append(f"- Final URL: {output.final_url}")
    lines.append(f"- HTTP status: {output.technical.http_status}")
    lines.append(f"- HTTPS: {'yes' if output.technical.https else 'no'}")
    lines.append(f"- Title: {output.technical.page_title or '(none)'}")
    lines.append("")

    by_category: dict[AuditCategory, list[Finding]] = {}
    for finding in output.findings:
        by_category.setdefault(finding.category, []).append(finding)

    kind_headers = {
        FindingKind.VERIFIED_FACT: "Verified facts",
        FindingKind.INFERENCE: "Inferences",
        FindingKind.SUBJECTIVE_OBSERVATION: "Subjective observations",
    }

    for category in AuditCategory:
        category_findings = by_category.get(category, [])
        lines.append(f"## {category.value.upper()}")
        if not category_findings:
            lines.append("No issues found.")
            lines.append("")
            continue
        for kind in (FindingKind.VERIFIED_FACT, FindingKind.INFERENCE, FindingKind.SUBJECTIVE_OBSERVATION):
            kind_findings = [f for f in category_findings if f.kind == kind]
            if not kind_findings:
                continue
            lines.append(f"**{kind_headers[kind]}:**")
            for f in kind_findings:
                detail = f" — {f.detail}" if f.detail else ""
                lines.append(f"- {f.label}{detail}")
        lines.append("")

    return "\n".join(lines)
