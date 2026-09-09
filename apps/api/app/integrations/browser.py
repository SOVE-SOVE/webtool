"""
Playwright wrapper — the one place that drives a real headless browser.
Used by agents/website_audit.py to gather real, measured evidence about
a lead's existing website (never a guessed/estimated number) per the
"no unsupported claims" requirement on the Sales Audit feature.
"""

import base64
import ipaddress
import json
import re
import socket
from dataclasses import dataclass, field
from urllib.parse import urlparse

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright

MOBILE_VIEWPORT = {"width": 375, "height": 667}
NAVIGATION_TIMEOUT_MS = 15_000
_ALLOWED_SCHEMES = {"http", "https"}


class UrlNotAllowedError(ValueError):
    """Raised for a `website_url` that isn't a safe audit target — see `_check_url_is_public`."""


def _parse_ip_literal(hostname: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """
    Parses `hostname` as an IP literal the way a browser does, or returns
    None if it's a real DNS name.

    This has to match Chromium rather than `getaddrinfo`, because the two
    disagree. Per the WHATWG URL spec a dotted host whose last part is
    numeric is an IPv4 address, and each part is hex for an `0x` prefix,
    octal for a leading `0`, decimal otherwise. `0177.0.0.1` is therefore
    127.0.0.1 to the browser, while macOS `getaddrinfo` reads it as
    177.0.0.1 — a public address. Validating the resolver's answer and
    then letting Chromium re-resolve the name let that difference through
    as a real SSRF: the guard passed and the browser fetched loopback.
    """
    if hostname.startswith("[") and hostname.endswith("]"):
        hostname = hostname[1:-1]
    try:
        return ipaddress.ip_address(hostname)
    except ValueError:
        pass

    parts = hostname.split(".")
    if parts and parts[-1] == "":  # a single trailing dot is allowed
        parts = parts[:-1]
    if not parts or len(parts) > 4:
        return None

    numbers: list[int] = []
    for part in parts:
        lowered = part.lower()
        try:
            if lowered.startswith("0x"):
                numbers.append(int(lowered[2:] or "0", 16))
            elif lowered.startswith("0") and len(lowered) > 1:
                numbers.append(int(lowered[1:], 8))
            else:
                numbers.append(int(lowered, 10))
        except ValueError:
            return None  # a non-numeric part means this is a DNS name

    # The last part absorbs the remaining low-order bytes ("127.1" is
    # 127.0.0.1), so only it may exceed a single byte.
    if any(n > 255 for n in numbers[:-1]) or numbers[-1] >= 256 ** (4 - len(numbers) + 1):
        return None
    value = numbers[-1]
    for index, number in enumerate(numbers[:-1]):
        value += number << (8 * (3 - index))
    return ipaddress.ip_address(value)


def _reject_if_not_public(hostname: str, ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    # is_global, rather than enumerating private/loopback/link-local/...:
    # the enumerated form silently allowed anything the list forgot, such
    # as the 100.64.0.0/10 carrier-grade NAT range.
    if not ip.is_global:
        raise UrlNotAllowedError(
            f"{hostname} resolves to a non-public address ({ip}) — not an allowed audit target"
        )


def _check_url_is_public(url: str) -> None:
    """
    SSRF guard, docs/06_SECURITY.md — `website_url` is operator-entered
    on a business record, but this app fetches it server-side with a
    real browser, so a malicious or mistaken entry (`http://localhost`,
    a cloud metadata address, an internal service) must not be able to
    make this server hit internal infrastructure. An IP literal is
    parsed and checked directly (see `_parse_ip_literal`); a DNS name is
    resolved and every address it answers with must be public. Known
    gap: this only checks the initial target, not addresses reached via
    redirect during navigation — full protection would need per-request
    interception, which is a larger change than this pass covers.
    """
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise UrlNotAllowedError(f"Unsupported URL scheme: {parsed.scheme!r}")
    hostname = parsed.hostname
    if not hostname:
        raise UrlNotAllowedError("URL has no hostname")
    if hostname.lower() == "localhost":
        raise UrlNotAllowedError("localhost is not an allowed audit target")

    literal = _parse_ip_literal(hostname)
    if literal is not None:
        # Don't also resolve it — the resolver's reading of an ambiguous
        # literal is exactly what disagrees with the browser's.
        _reject_if_not_public(hostname, literal)
        return

    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise UrlNotAllowedError(f"Could not resolve hostname {hostname!r}: {exc}") from exc

    for _, _, _, _, sockaddr in resolved:
        _reject_if_not_public(hostname, ipaddress.ip_address(sockaddr[0]))


@dataclass
class PageSignals:
    final_url: str | None = None
    https: bool | None = None
    http_status: int | None = None
    title: str | None = None
    meta_description: str | None = None
    viewport_meta_present: bool | None = None
    mobile_overflow: bool | None = None  # True = horizontal overflow at mobile width
    load_time_ms: int | None = None
    error: str | None = None


async def fetch_page_signals(url: str) -> PageSignals:
    """
    Renders `url` in headless Chromium at a mobile viewport and returns
    only what was actually measured. On navigation failure (timeout,
    DNS, refused connection, etc.) — or a rejected non-public target,
    see `_check_url_is_public` — returns a PageSignals with `error` set
    and everything else left `None` — never a guessed value.
    """
    try:
        _check_url_is_public(url)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            try:
                page = await browser.new_page(viewport=MOBILE_VIEWPORT)
                response = await page.goto(
                    url, wait_until="load", timeout=NAVIGATION_TIMEOUT_MS
                )

                title = await page.title()
                meta_description = await page.evaluate(
                    "() => document.querySelector('meta[name=\"description\"]')?.content ?? null"
                )
                viewport_meta_present = await page.evaluate(
                    "() => document.querySelector('meta[name=\"viewport\"]') !== null"
                )
                mobile_overflow = await page.evaluate(
                    "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
                )
                load_time_ms = await page.evaluate(
                    "() => { const nav = performance.getEntriesByType('navigation')[0]; "
                    "return nav ? Math.round(nav.duration) : null; }"
                )

                final_url = page.url
                return PageSignals(
                    final_url=final_url,
                    https=final_url.startswith("https://"),
                    http_status=response.status if response else None,
                    title=title or None,
                    meta_description=meta_description,
                    viewport_meta_present=viewport_meta_present,
                    mobile_overflow=mobile_overflow,
                    load_time_ms=load_time_ms,
                )
            finally:
                await browser.close()
    except PlaywrightError as exc:
        return PageSignals(error=str(exc))
    except Exception as exc:  # navigation timeouts etc. surface as generic errors too
        return PageSignals(error=str(exc))


DESKTOP_VIEWPORT = {"width": 1440, "height": 900}
TABLET_VIEWPORT = {"width": 768, "height": 1024}

# Minimal, real WCAG relative-luminance contrast check over a sample of
# text elements — not a full axe-core-style audit, but genuinely
# measured against the live page rather than guessed.
_CONTRAST_SAMPLE_JS = """
() => {
  function luminance(rgbString) {
    const nums = rgbString.match(/[\\d.]+/g);
    if (!nums) return null;
    const [r, g, b] = nums.slice(0, 3).map(Number).map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    if (la === null || lb === null) return null;
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }
  const candidates = Array.from(document.querySelectorAll('h1, h2, h3, p, a, button, label')).slice(0, 30);
  let minRatio = null;
  for (const el of candidates) {
    if (!el.textContent || !el.textContent.trim()) continue;
    const color = getComputedStyle(el).color;
    let bgEl = el;
    let bg = null;
    while (bgEl) {
      const bgColor = getComputedStyle(bgEl).backgroundColor;
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') { bg = bgColor; break; }
      bgEl = bgEl.parentElement;
    }
    const ratio = contrastRatio(color, bg || 'rgb(255, 255, 255)');
    if (ratio !== null && (minRatio === null || ratio < minRatio)) minRatio = ratio;
  }
  return minRatio;
}
"""


@dataclass
class QaPageSignals:
    https: bool | None = None
    desktop_overflow: bool | None = None
    tablet_overflow: bool | None = None
    mobile_overflow: bool | None = None
    console_errors: list[str] | None = None
    broken_internal_links: list[str] | None = None
    min_contrast_ratio: float | None = None
    total_transfer_bytes: int | None = None
    duplicate_ids: list[str] | None = None
    html_lang_present: bool | None = None
    error: str | None = None


async def fetch_qa_signals(base_url: str, page_paths: list[str]) -> QaPageSignals:
    """
    Drives a real headless browser against `base_url` (the site's first
    page) plus every other path in `page_paths`, for agents/technical_qa.py's
    live-preview checks. `base_url` must already be the exact URL for
    the first entry in `page_paths`. Same SSRF guard as fetch_page_signals
    — this fetches an operator-supplied preview URL server-side too.
    """
    try:
        _check_url_is_public(base_url)
        parsed = urlparse(base_url)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        console_errors: list[str] = []
        transfer_bytes = 0

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            try:
                page = await browser.new_page(viewport=DESKTOP_VIEWPORT)
                page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

                async def _on_response(response):
                    nonlocal transfer_bytes
                    try:
                        length = response.headers.get("content-length")
                        if length:
                            transfer_bytes += int(length)
                    except Exception:
                        pass

                page.on("response", _on_response)

                await page.goto(base_url, wait_until="load", timeout=NAVIGATION_TIMEOUT_MS)
                final_url = page.url

                desktop_overflow = await page.evaluate(
                    "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
                )
                min_contrast_ratio = await page.evaluate(_CONTRAST_SAMPLE_JS)
                html_lang_present = await page.evaluate(
                    "() => !!(document.documentElement.getAttribute('lang') || '').trim()"
                )
                duplicate_ids = await page.evaluate(
                    "() => { const seen = new Map(); "
                    "for (const el of document.querySelectorAll('[id]')) { "
                    "seen.set(el.id, (seen.get(el.id) || 0) + 1); } "
                    "return Array.from(seen.entries()).filter(([, n]) => n > 1).map(([id]) => id); }"
                )

                await page.set_viewport_size(TABLET_VIEWPORT)
                tablet_overflow = await page.evaluate(
                    "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
                )
                await page.set_viewport_size(MOBILE_VIEWPORT)
                mobile_overflow = await page.evaluate(
                    "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
                )

                broken_links: list[str] = []
                for path in page_paths:
                    target = f"{origin}{path}"
                    if target == base_url or target == final_url:
                        continue
                    try:
                        link_response = await page.request.get(target, timeout=NAVIGATION_TIMEOUT_MS)
                        if link_response.status >= 400:
                            broken_links.append(path)
                    except Exception:
                        broken_links.append(path)

                return QaPageSignals(
                    https=final_url.startswith("https://"),
                    desktop_overflow=desktop_overflow,
                    tablet_overflow=tablet_overflow,
                    mobile_overflow=mobile_overflow,
                    console_errors=console_errors,
                    broken_internal_links=broken_links,
                    min_contrast_ratio=min_contrast_ratio,
                    total_transfer_bytes=transfer_bytes or None,
                    duplicate_ids=duplicate_ids,
                    html_lang_present=html_lang_present,
                )
            finally:
                await browser.close()
    except PlaywrightError as exc:
        return QaPageSignals(error=str(exc))
    except UrlNotAllowedError as exc:
        return QaPageSignals(error=str(exc))
    except Exception as exc:
        return QaPageSignals(error=str(exc))


@dataclass
class ResearchPageSignals:
    """Real, measured signals for Lead Intelligence's website research
    stage (agents/business_research.py) — a different signal set from
    PageSignals: this needs actual page *content* (contact links, social
    links, footer text) to answer "does this business have a contact
    path / social presence / obvious placeholder content", not just
    load/metadata signals."""

    final_url: str | None = None
    https: bool | None = None
    http_status: int | None = None
    title: str | None = None
    meta_description: str | None = None
    viewport_meta_present: bool | None = None
    mobile_overflow: bool | None = None
    generator_meta: str | None = None
    contact_cta_present: bool | None = None
    # The actual phone/email a visitor would use, read straight off the
    # first tel:/mailto: link on the page — a directly-observed value, not
    # a guess. None when the page has no such link (a bare contact form
    # still sets contact_cta_present but gives nothing to dial/email).
    contact_phone: str | None = None
    contact_email: str | None = None
    social_links: list[str] | None = None
    body_text: str | None = None
    load_time_ms: int | None = None
    # Structured facts the site publishes about itself in schema.org
    # (JSON-LD) markup — directly observed, not geocoded or guessed.
    # lat/lng come only from an explicit GeoCoordinates node; both are
    # set together or both stay None.
    postal_address: str | None = None
    country: str | None = None
    business_category: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    error: str | None = None


@dataclass
class JsonLdLocation:
    address: str | None = None
    country: str | None = None
    category: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    # Every raw @type string seen while walking the document (lowercased),
    # kept alongside the humanised `category` above so callers that need
    # to test for a specific schema.org type family (e.g. "is this
    # LocalBusiness or one of its subtypes") don't have to re-walk the
    # JSON-LD themselves.
    raw_types: set[str] = field(default_factory=set)

    @property
    def complete(self) -> bool:
        return self.address is not None and self.latitude is not None


# schema.org's LocalBusiness and its common subtypes — used to answer
# "does this page identify itself as a local business" for Planning's
# SEO/local-readiness signal. Not exhaustive (schema.org has hundreds of
# LocalBusiness subtypes); covers the ones a small local business site
# is realistically marked up with.
_LOCAL_BUSINESS_SCHEMA_TYPES = frozenset(
    {
        "localbusiness",
        "store",
        "restaurant",
        "foodestablishment",
        "cafeorcoffeeshop",
        "bakery",
        "bar",
        "professionalservice",
        "homeandconstructionbusiness",
        "generalcontractor",
        "electrician",
        "plumber",
        "roofingcontractor",
        "housepainter",
        "autorepair",
        "automotivebusiness",
        "dentist",
        "physician",
        "medicalbusiness",
        "lawyer",
        "legalservice",
        "beautysalon",
        "hairsalon",
        "healthclub",
        "gymorfitnesscenter",
        "realestateagent",
        "travelagency",
        "financialservice",
        "accountingservice",
        "insuranceagency",
        "veterinarycare",
        "childcare",
        "florist",
        "movingcompany",
        "landscaping",
        "drycleaningorlaundry",
    }
)


def _coerce_coord(value, lo: float, hi: float) -> float | None:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num == 0.0 or not lo <= num <= hi:
        return None
    return num


# schema.org @types that are wrappers / not a business category.
_NON_CATEGORY_TYPES = {
    "website",
    "webpage",
    "website",
    "breadcrumblist",
    "organization",
    "corporation",
    "person",
    "article",
    "newsarticle",
    "blogposting",
    "itemlist",
    "searchaction",
    "postaladdress",
    "geocoordinates",
    "openinghoursspecification",
    "imageobject",
    "review",
    "aggregaterating",
}


def _humanise_type(t: str) -> str:
    """'CafeOrCoffeeShop' -> 'Cafe or coffee shop'."""
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", t).replace("_", " ").strip()
    return spaced[:1].upper() + spaced[1:].lower() if spaced else t


def _address_country(node) -> str | None:
    if not isinstance(node, dict):
        return None
    c = node.get("addressCountry")
    if isinstance(c, dict):
        c = c.get("name")
    return str(c).strip() if c and str(c).strip() else None


def _format_postal_address(node) -> str | None:
    if isinstance(node, str):
        return node.strip() or None
    if not isinstance(node, dict):
        return None
    parts = [
        node.get("streetAddress"),
        node.get("addressLocality"),
        node.get("addressRegion"),
        node.get("postalCode"),
        _address_country(node),
    ]
    joined = ", ".join(str(p).strip() for p in parts if p and str(p).strip())
    return joined or None


def _node_category(node: dict) -> str | None:
    raw = node.get("@type")
    types = raw if isinstance(raw, list) else [raw]
    for t in types:
        if isinstance(t, str) and t.strip().lower() not in _NON_CATEGORY_TYPES:
            return _humanise_type(t.strip())
    return None


def _walk_jsonld(node, found: JsonLdLocation) -> None:
    """Depth-first scan of one parsed JSON-LD document for the first
    address / country / category / GeoCoordinates it carries. Handles a
    bare object, a list, and the common `@graph` wrapper."""
    if isinstance(node, list):
        for item in node:
            _walk_jsonld(item, found)
        return
    if not isinstance(node, dict):
        return

    if "address" in node and found.address is None:
        found.address = _format_postal_address(node["address"])
        if found.country is None:
            found.country = _address_country(node["address"])
    if found.category is None:
        found.category = _node_category(node)

    raw = node.get("@type")
    for t in raw if isinstance(raw, list) else [raw]:
        if isinstance(t, str) and t.strip():
            found.raw_types.add(t.strip().lower())

    geo = node.get("geo")
    if isinstance(geo, dict) and found.latitude is None:
        lat = _coerce_coord(geo.get("latitude"), -90.0, 90.0)
        lng = _coerce_coord(geo.get("longitude"), -180.0, 180.0)
        if lat is not None and lng is not None:
            found.latitude, found.longitude = lat, lng

    for key in ("@graph", "hasPart", "subOrganization", "location", "makesOffer"):
        if key in node:
            _walk_jsonld(node[key], found)


def _extract_location_from_jsonld(blocks: list[str]) -> JsonLdLocation:
    found = JsonLdLocation()
    for raw in blocks or []:
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            continue
        _walk_jsonld(parsed, found)
        if found.complete:
            break
    return found


async def fetch_research_signals(url: str) -> ResearchPageSignals:
    """
    Same navigation/SSRF-guard shape as fetch_page_signals, plus DOM
    inspection for business-research signals: a contact path
    (mailto/tel link or a <form>), social-platform links found on the
    page, the <meta name="generator"> tag (many site builders/CMSs emit
    one), and the page's visible text (the caller — agents/
    business_research.py — regex-searches this for a copyright year and
    obvious placeholder content; done in Python rather than in-page JS
    so the matching logic stays testable without a browser).
    """
    try:
        _check_url_is_public(url)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            try:
                page = await browser.new_page(viewport=MOBILE_VIEWPORT)
                response = await page.goto(url, wait_until="load", timeout=NAVIGATION_TIMEOUT_MS)

                title = await page.title()
                meta_description = await page.evaluate(
                    "() => document.querySelector('meta[name=\"description\"]')?.content ?? null"
                )
                viewport_meta_present = await page.evaluate(
                    "() => document.querySelector('meta[name=\"viewport\"]') !== null"
                )
                mobile_overflow = await page.evaluate(
                    "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
                )
                generator_meta = await page.evaluate(
                    "() => document.querySelector('meta[name=\"generator\"]')?.content ?? null"
                )
                contact_cta_present = await page.evaluate(
                    "() => !!document.querySelector('a[href^=\"mailto:\"], a[href^=\"tel:\"], form')"
                )
                # A malformed href must never take down the whole research
                # fetch — fall back to the raw value, or null, on any error.
                contact_phone = await page.evaluate(
                    "() => { const a = document.querySelector('a[href^=\"tel:\"]'); if (!a) return null; "
                    "const raw = a.getAttribute('href').slice(4); "
                    "try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); } }"
                )
                contact_email = await page.evaluate(
                    "() => { const a = document.querySelector('a[href^=\"mailto:\"]'); if (!a) return null; "
                    "const raw = a.getAttribute('href').slice(7).split('?')[0]; "
                    "try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); } }"
                )
                social_links = await page.evaluate(
                    "() => Array.from(document.querySelectorAll('a[href]'))"
                    ".map(a => a.href)"
                    ".filter(href => /facebook\\.com|instagram\\.com|linkedin\\.com|(?:twitter|x)\\.com|tiktok\\.com/i.test(href))"
                )
                body_text = await page.evaluate("() => document.body ? document.body.innerText : null")
                load_time_ms = await page.evaluate(
                    "() => { const nav = performance.getEntriesByType('navigation')[0]; "
                    "return nav ? Math.round(nav.duration) : null; }"
                )
                jsonld_blocks = await page.evaluate(
                    "() => Array.from(document.querySelectorAll('script[type=\"application/ld+json\"]'))"
                    ".map(s => s.textContent).filter(Boolean)"
                )
                loc = _extract_location_from_jsonld(jsonld_blocks)

                final_url = page.url
                return ResearchPageSignals(
                    final_url=final_url,
                    https=final_url.startswith("https://"),
                    http_status=response.status if response else None,
                    title=title or None,
                    meta_description=meta_description,
                    viewport_meta_present=viewport_meta_present,
                    mobile_overflow=mobile_overflow,
                    generator_meta=generator_meta,
                    contact_cta_present=contact_cta_present,
                    contact_phone=contact_phone or None,
                    contact_email=contact_email or None,
                    social_links=sorted(set(social_links)) if social_links else [],
                    body_text=body_text,
                    load_time_ms=load_time_ms,
                    postal_address=loc.address,
                    country=loc.country,
                    business_category=loc.category,
                    latitude=loc.latitude,
                    longitude=loc.longitude,
                )
            finally:
                await browser.close()
    except PlaywrightError as exc:
        return ResearchPageSignals(error=str(exc))
    except UrlNotAllowedError as exc:
        return ResearchPageSignals(error=str(exc))
    except Exception as exc:
        return ResearchPageSignals(error=str(exc))


_MAX_LINKS_CHECKED = 8

# Same needle list as agents/business_research.py's placeholder check —
# duplicated rather than imported because agents/* imports from this
# module, not the other way around.
_PLACEHOLDER_NEEDLES = (
    "lorem ipsum",
    "your company name",
    "your business name",
    "sample text",
    "placeholder text",
    "this is a sample",
)


def _has_placeholder_text(body_text: str | None) -> bool:
    if not body_text:
        return False
    lowered = body_text.lower()
    return any(needle in lowered for needle in _PLACEHOLDER_NEEDLES)


@dataclass
class PlanningAuditSignals:
    """
    Real, measured signals for Planning's Website Summary / Key Points
    (agents/planning_audit.py) — one browser session gathering the
    technical, SEO, accessibility and usability signals listed under
    "Website Audit Inputs", plus a desktop and mobile screenshot for the
    visual review step. Deliberately one function rather than three
    separate page loads: every check below reuses a helper already
    written for fetch_research_signals / fetch_qa_signals (the JSON-LD
    walker, the contrast sampler, the overflow check), just gathered
    together against an arbitrary external target in a single pass.
    """

    final_url: str | None = None
    https: bool | None = None
    http_status: int | None = None
    title: str | None = None
    meta_description: str | None = None
    viewport_meta_present: bool | None = None
    desktop_overflow: bool | None = None
    tablet_overflow: bool | None = None
    mobile_overflow: bool | None = None
    load_time_ms: int | None = None
    total_transfer_bytes: int | None = None
    console_error_count: int | None = None
    broken_internal_links: list[str] | None = None
    min_contrast_ratio: float | None = None
    duplicate_ids: list[str] | None = None
    html_lang_present: bool | None = None
    h1_count: int | None = None
    canonical_present: bool | None = None
    meta_robots_noindex: bool | None = None
    robots_txt_reachable: bool | None = None
    sitemap_xml_reachable: bool | None = None
    has_local_business_schema: bool | None = None
    postal_address: str | None = None
    business_category: str | None = None
    contact_cta_present: bool | None = None
    contact_phone: str | None = None
    contact_email: str | None = None
    social_links: list[str] | None = None
    generator_meta: str | None = None
    appears_template_or_placeholder: bool | None = None
    # PNG bytes, base64-encoded — this app has no blob/file storage, so
    # these are persisted directly on the audit row rather than to a new
    # storage layer, per "smallest clean extension".
    screenshot_desktop_base64: str | None = None
    screenshot_mobile_base64: str | None = None
    error: str | None = None


async def fetch_planning_audit_signals(url: str) -> PlanningAuditSignals:
    """Same navigation/SSRF-guard shape as the other fetch_* functions."""
    try:
        _check_url_is_public(url)
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        console_error_count = 0
        transfer_bytes = 0

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch()
            try:
                page = await browser.new_page(viewport=DESKTOP_VIEWPORT)

                def _on_console(msg):
                    nonlocal console_error_count
                    if msg.type == "error":
                        console_error_count += 1

                page.on("console", _on_console)

                async def _on_response(response):
                    nonlocal transfer_bytes
                    try:
                        length = response.headers.get("content-length")
                        if length:
                            transfer_bytes += int(length)
                    except Exception:
                        pass

                page.on("response", _on_response)

                response = await page.goto(url, wait_until="load", timeout=NAVIGATION_TIMEOUT_MS)
                final_url = page.url

                title = await page.title()
                meta_description = await page.evaluate(
                    "() => document.querySelector('meta[name=\"description\"]')?.content ?? null"
                )
                viewport_meta_present = await page.evaluate(
                    "() => document.querySelector('meta[name=\"viewport\"]') !== null"
                )
                generator_meta = await page.evaluate(
                    "() => document.querySelector('meta[name=\"generator\"]')?.content ?? null"
                )
                contact_cta_present = await page.evaluate(
                    "() => !!document.querySelector('a[href^=\"mailto:\"], a[href^=\"tel:\"], form')"
                )
                contact_phone = await page.evaluate(
                    "() => { const a = document.querySelector('a[href^=\"tel:\"]'); if (!a) return null; "
                    "const raw = a.getAttribute('href').slice(4); "
                    "try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); } }"
                )
                contact_email = await page.evaluate(
                    "() => { const a = document.querySelector('a[href^=\"mailto:\"]'); if (!a) return null; "
                    "const raw = a.getAttribute('href').slice(7).split('?')[0]; "
                    "try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); } }"
                )
                social_links = await page.evaluate(
                    "() => Array.from(document.querySelectorAll('a[href]'))"
                    ".map(a => a.href)"
                    ".filter(href => /facebook\\.com|instagram\\.com|linkedin\\.com|(?:twitter|x)\\.com|tiktok\\.com/i.test(href))"
                )
                body_text = await page.evaluate("() => document.body ? document.body.innerText : null")
                canonical_present = await page.evaluate(
                    "() => document.querySelector('link[rel=\"canonical\"]') !== null"
                )
                meta_robots_noindex = await page.evaluate(
                    "() => /noindex/i.test(document.querySelector('meta[name=\"robots\"]')?.content || '')"
                )
                h1_count = await page.evaluate("() => document.querySelectorAll('h1').length")
                html_lang_present = await page.evaluate(
                    "() => !!(document.documentElement.getAttribute('lang') || '').trim()"
                )
                duplicate_ids = await page.evaluate(
                    "() => { const seen = new Map(); "
                    "for (const el of document.querySelectorAll('[id]')) { "
                    "seen.set(el.id, (seen.get(el.id) || 0) + 1); } "
                    "return Array.from(seen.entries()).filter(([, n]) => n > 1).map(([id]) => id); }"
                )
                min_contrast_ratio = await page.evaluate(_CONTRAST_SAMPLE_JS)
                desktop_overflow = await page.evaluate(
                    "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
                )
                internal_links = await page.evaluate(
                    f"""() => Array.from(document.querySelectorAll('a[href]'))
                    .map(a => a.href)
                    .filter(href => href.startsWith({origin!r}))
                    .slice(0, {_MAX_LINKS_CHECKED * 3})"""
                )
                jsonld_blocks = await page.evaluate(
                    "() => Array.from(document.querySelectorAll('script[type=\"application/ld+json\"]'))"
                    ".map(s => s.textContent).filter(Boolean)"
                )
                load_time_ms = await page.evaluate(
                    "() => { const nav = performance.getEntriesByType('navigation')[0]; "
                    "return nav ? Math.round(nav.duration) : null; }"
                )

                screenshot_desktop = await page.screenshot(type="png")

                broken_links: list[str] = []
                seen_paths: set[str] = set()
                for link in internal_links:
                    path = urlparse(link).path or "/"
                    if path in seen_paths or link == final_url:
                        continue
                    seen_paths.add(path)
                    if len(seen_paths) > _MAX_LINKS_CHECKED:
                        break
                    try:
                        link_response = await page.request.get(link, timeout=NAVIGATION_TIMEOUT_MS)
                        if link_response.status >= 400:
                            broken_links.append(path)
                    except Exception:
                        broken_links.append(path)

                robots_txt_reachable = None
                sitemap_xml_reachable = None
                try:
                    r = await page.request.get(f"{origin}/robots.txt", timeout=NAVIGATION_TIMEOUT_MS)
                    robots_txt_reachable = r.status < 400
                except Exception:
                    robots_txt_reachable = False
                try:
                    r = await page.request.get(f"{origin}/sitemap.xml", timeout=NAVIGATION_TIMEOUT_MS)
                    sitemap_xml_reachable = r.status < 400
                except Exception:
                    sitemap_xml_reachable = False

                await page.set_viewport_size(TABLET_VIEWPORT)
                tablet_overflow = await page.evaluate(
                    "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
                )

                await page.set_viewport_size(MOBILE_VIEWPORT)
                mobile_overflow = await page.evaluate(
                    "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
                )
                screenshot_mobile = await page.screenshot(type="png")

                loc = _extract_location_from_jsonld(jsonld_blocks)
                has_local_business_schema = bool(loc.raw_types & _LOCAL_BUSINESS_SCHEMA_TYPES) or None

                return PlanningAuditSignals(
                    final_url=final_url,
                    https=final_url.startswith("https://"),
                    http_status=response.status if response else None,
                    title=title or None,
                    meta_description=meta_description,
                    viewport_meta_present=viewport_meta_present,
                    desktop_overflow=desktop_overflow,
                    tablet_overflow=tablet_overflow,
                    mobile_overflow=mobile_overflow,
                    load_time_ms=load_time_ms,
                    total_transfer_bytes=transfer_bytes or None,
                    console_error_count=console_error_count,
                    broken_internal_links=broken_links,
                    min_contrast_ratio=min_contrast_ratio,
                    duplicate_ids=duplicate_ids,
                    html_lang_present=html_lang_present,
                    h1_count=h1_count,
                    canonical_present=canonical_present,
                    meta_robots_noindex=meta_robots_noindex,
                    robots_txt_reachable=robots_txt_reachable,
                    sitemap_xml_reachable=sitemap_xml_reachable,
                    has_local_business_schema=has_local_business_schema,
                    postal_address=loc.address,
                    business_category=loc.category,
                    contact_cta_present=contact_cta_present,
                    contact_phone=contact_phone or None,
                    contact_email=contact_email or None,
                    social_links=sorted(set(social_links)) if social_links else [],
                    generator_meta=generator_meta,
                    appears_template_or_placeholder=_has_placeholder_text(body_text) or None,
                    screenshot_desktop_base64=base64.b64encode(screenshot_desktop).decode("ascii"),
                    screenshot_mobile_base64=base64.b64encode(screenshot_mobile).decode("ascii"),
                )
            finally:
                await browser.close()
    except PlaywrightError as exc:
        return PlanningAuditSignals(error=str(exc))
    except UrlNotAllowedError as exc:
        return PlanningAuditSignals(error=str(exc))
    except Exception as exc:
        return PlanningAuditSignals(error=str(exc))
