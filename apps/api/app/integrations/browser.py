"""
Playwright wrapper — the one place that drives a real headless browser.
Used by agents/website_audit.py to gather real, measured evidence about
a lead's existing website (never a guessed/estimated number) per the
"no unsupported claims" requirement on the Sales Audit feature.
"""

import ipaddress
import socket
from dataclasses import dataclass
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
    social_links: list[str] | None = None
    body_text: str | None = None
    error: str | None = None


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
                social_links = await page.evaluate(
                    "() => Array.from(document.querySelectorAll('a[href]'))"
                    ".map(a => a.href)"
                    ".filter(href => /facebook\\.com|instagram\\.com|linkedin\\.com|(?:twitter|x)\\.com|tiktok\\.com/i.test(href))"
                )
                body_text = await page.evaluate("() => document.body ? document.body.innerText : null")

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
                    social_links=sorted(set(social_links)) if social_links else [],
                    body_text=body_text,
                )
            finally:
                await browser.close()
    except PlaywrightError as exc:
        return ResearchPageSignals(error=str(exc))
    except UrlNotAllowedError as exc:
        return ResearchPageSignals(error=str(exc))
    except Exception as exc:
        return ResearchPageSignals(error=str(exc))
