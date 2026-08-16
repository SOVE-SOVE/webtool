"""
SSRF-safe HTTP fetching. Every outbound request this app makes to a
prospect-supplied URL (website audits, and any future integration that
fetches an external site) must go through here, never through a bare
httpx/requests call — see docs/06_SECURITY.md.

Threat model: a lead's `website_url` is untrusted input. A malicious or
compromised value could point at `localhost`, a private/internal IP, a
cloud metadata endpoint, or redirect to one of those after an initial
safe-looking hostname. This module defends against all of those:

1. Only `http`/`https` schemes are allowed — no `file://`, `ftp://`,
   `gopher://`, etc.
2. The hostname is resolved via DNS ourselves, and *every* resolved
   address (a hostname can resolve to several) is checked against a
   deny-list of private/loopback/link-local/multicast/reserved/CGNAT
   ranges (IPv4 and IPv6 both — this also covers the common cloud
   metadata addresses: 169.254.169.254 is link-local, and 100.100.100.100
   falls inside the CGNAT range 100.64.0.0/10).
3. The actual TCP connection is made directly to the *validated* IP
   (not re-resolved by the HTTP stack), with the original hostname sent
   via the `Host` header and TLS SNI. This closes the DNS-rebinding gap
   where a second lookup at connect time could return a different,
   unsafe address than the one just validated.
4. Redirects are followed manually, up to a small limit, with the full
   validate-then-pin pipeline repeated at every hop — a same-looking
   redirect chain that ends at an internal address is a well-known SSRF
   bypass technique and is not meaningfully different from the initial
   request.
"""

import ipaddress
import socket
from dataclasses import dataclass

import httpx

ALLOWED_SCHEMES = {"http", "https"}
DEFAULT_TIMEOUT_SECONDS = 10.0
MAX_REDIRECTS = 3
MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5MB — plenty for HTML/CSS, bounds worst case
USER_AGENT = "WebDesignOS-AuditBot/1.0 (+https://webdesignos.example)"

# CGNAT (100.64.0.0/10) also covers the Alibaba Cloud metadata address
# 100.100.100.100, so no separate entry is needed for it.
_EXTRA_BLOCKED_NETWORKS = (
    ipaddress.ip_network("100.64.0.0/10"),  # Carrier-grade NAT
)


class SSRFBlockedError(Exception):
    """Raised when a URL (or a redirect target) resolves to a disallowed destination."""


class AuditFetchError(Exception):
    """Raised for ordinary fetch failures — timeouts, connection errors, DNS failures."""


@dataclass
class SafeResponse:
    status_code: int
    headers: httpx.Headers
    text: str
    content: bytes
    final_url: str


def _is_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False
    return not any(ip in net for net in _EXTRA_BLOCKED_NETWORKS if ip.version == net.version)


def _resolve_and_validate(hostname: str) -> str:
    """
    Resolves `hostname` and returns one validated, safe-to-connect-to IP
    address. A hostname that simply fails to resolve (doesn't exist, or
    no network) is an ordinary fetch failure, not a security block — it
    raises AuditFetchError. SSRFBlockedError is reserved for resolution
    that *succeeds* but points somewhere disallowed — a hostname that
    resolves to a mix of public and private addresses is treated as
    unsafe, since we can't control which one a caller downstream of us
    would actually connect to.
    """
    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise AuditFetchError(f"Could not resolve host '{hostname}': {exc}") from exc

    resolved_ips = {info[4][0] for info in addr_infos}
    if not resolved_ips:
        raise AuditFetchError(f"Host '{hostname}' did not resolve to any address")

    for raw_ip in resolved_ips:
        ip = ipaddress.ip_address(raw_ip.split("%")[0])  # strip IPv6 zone id if present
        if not _is_public_ip(ip):
            raise SSRFBlockedError(f"Host '{hostname}' resolves to a disallowed address ({raw_ip})")

    # Prefer an IPv4 address when both families are present, purely for
    # predictability in tests/logs — either is equally validated above.
    for raw_ip in sorted(resolved_ips):
        if "." in raw_ip:
            return raw_ip
    return next(iter(resolved_ips))


def _validate_url(url: httpx.URL) -> str:
    if url.scheme not in ALLOWED_SCHEMES:
        raise SSRFBlockedError(f"Scheme '{url.scheme}' is not allowed")
    if not url.host:
        raise SSRFBlockedError("URL has no host")
    return _resolve_and_validate(url.host)


def _pinned_request(client: httpx.Client, method: str, url: httpx.URL, ip: str) -> httpx.Request:
    pinned = url.copy_with(host=ip)
    request = client.build_request(method, pinned, headers={"Host": url.host})
    # Tells httpx/httpcore to use `url.host` for TLS SNI and certificate
    # verification even though the connection targets `ip` directly —
    # this is what lets us pin the connection without breaking HTTPS.
    request.extensions["sni_hostname"] = url.host
    return request


def safe_fetch(url: str, *, method: str = "GET", timeout: float = DEFAULT_TIMEOUT_SECONDS) -> SafeResponse:
    """
    Fetches `url` with SSRF protections applied to the initial request
    and to every redirect hop. Raises SSRFBlockedError for a disallowed
    destination and AuditFetchError for ordinary network failures.
    """
    try:
        current_url = httpx.URL(url)
    except httpx.InvalidURL as exc:
        raise SSRFBlockedError(f"Invalid URL '{url}': {exc}") from exc
    headers = {"User-Agent": USER_AGENT}

    with httpx.Client(timeout=timeout, headers=headers, follow_redirects=False) as client:
        for _ in range(MAX_REDIRECTS + 1):
            ip = _validate_url(current_url)
            request = _pinned_request(client, method, current_url, ip)
            try:
                response = client.send(request)
            except httpx.HTTPError as exc:
                raise AuditFetchError(f"Request to '{current_url}' failed: {exc}") from exc

            if response.is_redirect:
                location = response.headers.get("location")
                response.close()
                if not location:
                    raise AuditFetchError(f"Redirect from '{current_url}' had no Location header")
                try:
                    current_url = current_url.join(location)
                except httpx.InvalidURL as exc:
                    raise SSRFBlockedError(f"Invalid redirect target '{location}': {exc}") from exc
                continue

            content = response.read()
            if len(content) > MAX_RESPONSE_BYTES:
                content = content[:MAX_RESPONSE_BYTES]
            return SafeResponse(
                status_code=response.status_code,
                headers=response.headers,
                text=content.decode(response.encoding or "utf-8", errors="replace"),
                content=content,
                final_url=str(current_url),
            )

        raise AuditFetchError(f"Too many redirects (> {MAX_REDIRECTS}) starting from '{url}'")


def safe_head(url: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> SafeResponse:
    return safe_fetch(url, method="HEAD", timeout=timeout)
