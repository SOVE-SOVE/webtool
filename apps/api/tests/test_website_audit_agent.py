"""
Unit tests for the website-audit engine (app/agents/website_audit.py).
Runs against real local HTTP servers serving crafted HTML fixtures, with
SSRF host validation bypassed (that's tested separately and thoroughly
in test_safe_http.py) so these tests focus purely on extraction
correctness and the VERIFIED_FACT / INFERENCE / SUBJECTIVE_OBSERVATION
labeling contract.
"""

import http.server
import threading

import pytest

from app.agents.website_audit import run
from app.agents.website_audit_schemas import FindingKind, WebsiteAuditInput
from app.integrations import safe_http


@pytest.fixture
def make_site(monkeypatch):
    servers = []

    def _make(routes: dict[str, tuple[int, bytes, dict]], default_content_type: str = "text/html"):
        class Handler(http.server.BaseHTTPRequestHandler):
            def _handle(self):
                status, body, headers = routes.get(self.path, (404, b"not found", {}))
                self.send_response(status)
                if "Content-Type" not in headers:
                    self.send_header("Content-Type", default_content_type)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)

            def do_GET(self):
                self._handle()

            def do_HEAD(self):
                self._handle()

            def log_message(self, *_a):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        servers.append((server, thread))
        return f"http://site-{len(servers)}.test:{port}"

    monkeypatch.setattr(safe_http, "_validate_url", lambda url: "127.0.0.1")
    yield _make
    for server, thread in servers:
        server.shutdown()
        thread.join(timeout=2)


GOOD_HTML = b"""<!DOCTYPE html>
<html lang="en">
<head>
<title>Joe's Plumbing - Reliable Local Plumber</title>
<meta name="description" content="Fast, affordable plumbing services in Geelong">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="http://site.test/">
<style>@media (max-width: 600px) { .x { color: blue; } }</style>
</head>
<body>
<h1>Joe's Plumbing</h1>
<h2>Services</h2>
<img src="/logo.png" alt="Joe's Plumbing logo">
<p>Call us: <a href="tel:+61399998888">03 9999 8888</a></p>
<a href="mailto:joe@example.test">Email us</a>
<form><input type="email" name="email"><textarea></textarea></form>
<a href="/contact">Get a Quote</a>
</body>
</html>"""


def test_full_audit_happy_path(make_site):
    base = make_site(
        {
            "/": (200, GOOD_HTML, {}),
            "/robots.txt": (200, b"User-agent: *\nAllow: /\n", {}),
            "/sitemap.xml": (200, b"<urlset></urlset>", {}),
            "/logo.png": (200, b"x" * 100, {}),
        }
    )
    result = run(WebsiteAuditInput(url=base + "/"))

    assert result.output.reachable is True
    assert result.flagged_for_review is False
    assert result.output.technical.http_status == 200
    assert result.output.technical.page_title == "Joe's Plumbing - Reliable Local Plumber"
    assert result.output.technical.meta_description.startswith("Fast, affordable")
    assert result.output.technical.https is False
    assert result.output.seo.heading_counts["h1"] == 1
    assert result.output.seo.canonical_url == "http://site.test/"
    assert result.output.seo.sitemap_found is True
    assert result.output.seo.robots_found is True
    assert result.output.seo.robots_disallows_all is False
    assert result.output.mobile.viewport_present is True
    assert result.output.mobile.media_query_count == 1
    assert result.output.accessibility.images_missing_alt == 0
    assert result.output.conversion.contact_form_present is True
    assert "tel:+61399998888" in result.output.conversion.contact_links
    assert "get a quote" in result.output.conversion.cta_texts_found
    assert "# Website audit:" in result.output.report_markdown


def test_unreachable_site_is_flagged_and_not_fabricated(make_site):
    result = run(WebsiteAuditInput(url="http://this-does-not-exist.invalid.test/"))

    assert result.output.reachable is False
    assert result.flagged_for_review is True
    assert result.output.block_reason
    # Nothing in the structured output should be fabricated for a site
    # that was never actually reached.
    assert result.output.technical.http_status is None
    assert result.output.technical.page_title is None
    assert result.output.seo.title is None
    assert result.output.findings[0].kind == FindingKind.VERIFIED_FACT


def test_blocked_url_is_flagged_not_silently_skipped():
    """Uses the real (unpatched) safe_http validation — this is the actual SSRF check, not a mock of it."""
    result = run(WebsiteAuditInput(url="http://169.254.169.254/latest/meta-data/"))

    assert result.output.reachable is False
    assert result.flagged_for_review is True
    assert "disallowed" in result.output.block_reason.lower() or "resolves" in result.output.block_reason.lower()


def test_missing_title_description_h1_are_verified_facts(make_site):
    html = b"<html><head></head><body><p>no headings here</p></body></html>"
    base = make_site({"/": (200, html, {})})
    result = run(WebsiteAuditInput(url=base + "/"))

    seo_facts = [f.label for f in result.output.findings if f.category.value == "seo" and f.kind == FindingKind.VERIFIED_FACT]
    assert "No <title> element" in seo_facts
    assert "No meta description" in seo_facts
    assert "No <h1> on the page" in seo_facts
    assert result.output.seo.title is None


def test_missing_alt_and_unlabeled_input_detected(make_site):
    html = b"""<html><head><title>T</title></head><body>
    <img src="/a.png"><img src="/b.png" alt="described">
    <form><input type="text" name="x"></form>
    </body></html>"""
    base = make_site({"/": (200, html, {})})
    result = run(WebsiteAuditInput(url=base + "/"))

    assert result.output.accessibility.images_total == 2
    assert result.output.accessibility.images_missing_alt == 1
    assert result.output.accessibility.inputs_missing_labels == 1
    # Contrast is explicitly never claimed to be measured, never fabricated.
    contrast_finding = next(f for f in result.output.findings if "contrast" in f.label.lower())
    assert contrast_finding.kind == FindingKind.SUBJECTIVE_OBSERVATION


def test_heading_hierarchy_skip_detected(make_site):
    html = b"<html><head><title>T</title></head><body><h1>A</h1><h4>skips h2/h3</h4></body></html>"
    base = make_site({"/": (200, html, {})})
    result = run(WebsiteAuditInput(url=base + "/"))

    assert any("skipped" in issue.lower() for issue in result.output.accessibility.heading_issues)


def test_broken_resource_detected(make_site):
    html = b'<html><head><title>T</title></head><body><img src="/missing.png"></body></html>'
    base = make_site({"/": (200, html, {})})  # /missing.png -> falls through to default 404
    result = run(WebsiteAuditInput(url=base + "/"))

    assert any("missing.png" in r for r in result.output.technical.broken_resources)
    broken_findings = [f for f in result.output.findings if f.category.value == "technical" and "broken" in f.label.lower()]
    assert broken_findings and broken_findings[0].kind == FindingKind.VERIFIED_FACT


def test_no_cta_or_contact_produces_friction_finding(make_site):
    html = b"<html><head><title>T</title></head><body><p>Just some text, nothing else.</p></body></html>"
    base = make_site({"/": (200, html, {})})
    result = run(WebsiteAuditInput(url=base + "/"))

    assert result.output.conversion.cta_texts_found == []
    assert result.output.conversion.contact_form_present is False
    friction = [f for f in result.output.findings if f.category.value == "conversion"]
    assert any(f.kind == FindingKind.SUBJECTIVE_OBSERVATION for f in friction)


def test_robots_disallow_all_detected(make_site):
    html = b"<html><head><title>T</title></head><body><h1>A</h1></body></html>"
    base = make_site(
        {"/": (200, html, {}), "/robots.txt": (200, b"User-agent: *\nDisallow: /\n", {})}
    )
    result = run(WebsiteAuditInput(url=base + "/"))

    assert result.output.seo.robots_disallows_all is True


def test_non_html_response_is_flagged(make_site):
    base = make_site({"/": (200, b'{"not": "html"}', {"Content-Type": "application/json"})})
    result = run(WebsiteAuditInput(url=base + "/"))

    assert result.output.reachable is True
    assert result.flagged_for_review is True
    assert result.output.technical.page_title is None


def test_http_error_status_flags_for_review(make_site):
    base = make_site({"/": (500, b"<html><head><title>Error</title></head><body></body></html>", {})})
    result = run(WebsiteAuditInput(url=base + "/"))

    assert result.output.technical.http_status == 500
    assert result.flagged_for_review is True


def test_every_finding_has_a_kind_label(make_site):
    """Contract check: nothing slips through unlabeled."""
    base = make_site({"/": (200, GOOD_HTML, {})})
    result = run(WebsiteAuditInput(url=base + "/"))

    for finding in result.output.findings:
        assert finding.kind in (
            FindingKind.VERIFIED_FACT,
            FindingKind.INFERENCE,
            FindingKind.SUBJECTIVE_OBSERVATION,
        )
