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


def _check_url_is_public(url: str) -> None:
    """
    SSRF guard, docs/06_SECURITY.md — `website_url` is operator-entered
    on a business record, but this app fetches it server-side with a
    real browser, so a malicious or mistaken entry (`http://localhost`,
    a cloud metadata address, an internal service) must not be able to
    make this server hit internal infrastructure. Resolves the hostname
    and rejects anything that isn't a public, routable address; an IP
    literal is checked directly. Known gap: this only checks the
    initial target, not addresses reached via redirect during
    navigation — full protection would need per-request interception,
    which is a larger change than this pass covers.
    """
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise UrlNotAllowedError(f"Unsupported URL scheme: {parsed.scheme!r}")
    hostname = parsed.hostname
    if not hostname:
        raise UrlNotAllowedError("URL has no hostname")
    if hostname.lower() == "localhost":
        raise UrlNotAllowedError("localhost is not an allowed audit target")

    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise UrlNotAllowedError(f"Could not resolve hostname {hostname!r}: {exc}") from exc

    for family, _, _, _, sockaddr in resolved:
        ip = ipaddress.ip_address(sockaddr[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise UrlNotAllowedError(f"{hostname} resolves to a non-public address ({ip}) — not an allowed audit target")


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
