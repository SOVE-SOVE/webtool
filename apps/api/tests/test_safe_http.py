"""
Security tests for the SSRF-safe HTTP layer (app/integrations/safe_http.py).
Every website audit fetches a lead-supplied, untrusted URL — these tests
exist to prove the well-known SSRF bypass techniques are actually blocked,
not just documented as blocked. See docs/06_SECURITY.md.
"""

import http.server
import threading

import pytest

from app.integrations import safe_http
from app.integrations.safe_http import AuditFetchError, SSRFBlockedError, safe_fetch


# --- Direct-target blocking -------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost",
        "http://localhost:8000",
        "http://127.0.0.1",
        "http://127.0.0.1:8080/admin",
        "http://0.0.0.0",
        "http://[::1]",  # IPv6 loopback
        "http://10.0.0.1",  # RFC1918 private
        "http://172.16.0.1",
        "http://172.31.255.255",
        "http://192.168.1.1",
        "http://169.254.169.254/latest/meta-data/",  # AWS/GCP metadata (link-local)
        "http://169.254.170.2",  # ECS task metadata (link-local)
        "http://100.100.100.100",  # Alibaba Cloud metadata (CGNAT range)
        "http://100.64.0.1",  # CGNAT
        "http://[fe80::1]",  # IPv6 link-local
        "http://[fc00::1]",  # IPv6 unique local address (private)
        "http://[fd00:ec2::254]",  # AWS IPv6 metadata (ULA range)
        "http://224.0.0.1",  # multicast
        "http://0177.0.0.1",  # octal-encoded 127.0.0.1
        "http://2130706433",  # decimal-encoded 127.0.0.1
        "http://017700000001",  # full octal-encoded 127.0.0.1
    ],
)
def test_blocks_unsafe_targets(url):
    with pytest.raises(SSRFBlockedError):
        safe_fetch(url, timeout=2)


@pytest.mark.parametrize("scheme_url", ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com"])
def test_blocks_disallowed_schemes(scheme_url):
    with pytest.raises(SSRFBlockedError):
        safe_fetch(scheme_url, timeout=2)


def test_unresolvable_host_is_a_fetch_failure_not_a_security_block():
    """
    A hostname that doesn't resolve (typo, no DNS, doesn't exist) is an
    ordinary fetch failure, not an SSRF policy rejection — those are
    surfaced differently in the audit UI ("couldn't reach it" vs.
    "we refused to audit this"), so the exception types must not blur.
    """
    with pytest.raises(AuditFetchError):
        safe_fetch("http://this-host-should-never-resolve.invalid", timeout=2)


# --- Mixed-resolution hostnames ---------------------------------------------


def test_blocks_hostname_that_resolves_to_mix_of_public_and_private(monkeypatch):
    """
    A hostname resolving to both a public and a private address is
    treated as unsafe entirely — we can't know which address a later
    connection attempt (ours or anyone downstream) will actually use.
    """

    def fake_getaddrinfo(host, *_args, **_kwargs):
        return [
            (2, 1, 6, "", ("93.184.216.34", 0)),  # public-looking
            (2, 1, 6, "", ("127.0.0.1", 0)),  # private
        ]

    monkeypatch.setattr(safe_http.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(SSRFBlockedError):
        safe_fetch("http://mixed-resolution.test", timeout=2)


# --- Redirect-hop re-validation ----------------------------------------------


def test_redirect_to_blocked_target_is_rejected(monkeypatch):
    """
    The classic SSRF bypass: an initial request to a safe-looking host
    redirects to an internal address. Each hop must be independently
    validated, not just the first one.
    """
    validated_hosts = []
    real_validate = safe_http._validate_url

    def fake_validate(url):
        validated_hosts.append(url.host)
        if url.host == "safe-looking.test":
            return "127.0.0.1"  # pretend this "safe" host is our local test server
        return real_validate(url)  # let the redirect target go through real validation

    class RedirectToMetadataHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()

        def log_message(self, *_a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), RedirectToMetadataHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setattr(safe_http, "_validate_url", fake_validate)
        with pytest.raises(SSRFBlockedError):
            safe_fetch(f"http://safe-looking.test:{port}", timeout=2)
    finally:
        server.shutdown()
        thread.join(timeout=2)

    assert "safe-looking.test" in validated_hosts
    assert "169.254.169.254" in validated_hosts  # the redirect hop was actually re-checked


def test_too_many_redirects_raises_fetch_error(monkeypatch):
    real_validate = safe_http._validate_url

    def fake_validate(url):
        if url.host in ("hop.test", "127.0.0.1"):
            return "127.0.0.1"
        return real_validate(url)

    class InfiniteRedirectHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", self.path + "x")  # always a "new" location, keeps redirecting
            self.end_headers()

        def log_message(self, *_a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), InfiniteRedirectHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setattr(safe_http, "_validate_url", fake_validate)
        with pytest.raises(AuditFetchError, match="[Tt]oo many redirects"):
            safe_fetch(f"http://hop.test:{port}/start", timeout=2)
    finally:
        server.shutdown()
        thread.join(timeout=2)


# --- Legitimate local traffic still works (sanity, not a security test) -----


def test_allows_a_real_local_server(monkeypatch):
    """
    Confirms the pinned-connection mechanics (build_request against the
    validated IP, sni_hostname extension, manual send) work end to end
    against a real socket — not just that blocking logic runs.
    """

    class OkHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"<html><head><title>Hi</title></head><body>ok</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), OkHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        # Bypass real DNS/IP validation for this one synthetic hostname
        # only, so the test doesn't depend on real DNS existing for it —
        # the connection itself still goes over a real socket.
        monkeypatch.setattr(safe_http, "_validate_url", lambda url: "127.0.0.1")
        response = safe_fetch(f"http://any-hostname.test:{port}/", timeout=2)
        assert response.status_code == 200
        assert "<title>Hi</title>" in response.text
    finally:
        server.shutdown()
        thread.join(timeout=2)
