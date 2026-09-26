"""Website Reference Library: shared workspace references, guarded preview
capture (stubbed — no real browsing in tests), plan attachments and handoff."""

import pytest

from app.integrations import browser
from app.jobs import runner
from app.jobs.handlers import HANDLERS
from app.modules.website_references import service as references_service


def _drain_jobs():
    while runner.run_once(HANDLERS):
        pass


def _lead_and_plan(client, name="Coastal Cafe"):
    lead = client.post("/api/v1/leads", json={"business_name": name, "suburb": "Byron Bay", "state": "NSW"}).json()
    return client.post(f"/api/v1/leads/{lead['id']}/planning").json()


@pytest.fixture
def capture_ok(monkeypatch):
    calls = []

    async def fake(url):
        calls.append(url)
        return browser.ReferenceCapture(b"\xff\xd8fakejpeg", url, None)

    monkeypatch.setattr(browser, "capture_reference_screenshot", fake)
    return calls


@pytest.fixture
def capture_fail(monkeypatch):
    async def fake(url):
        return browser.ReferenceCapture(None, None, "The page couldn't be loaded (timeout).")

    monkeypatch.setattr(browser, "capture_reference_screenshot", fake)


def test_add_captures_once_and_serves_stored_preview(authed_client, capture_ok):
    res = authed_client.post(
        "/api/v1/website-references",
        json={"url": "Example.com/", "tags": ["Minimal", "minimal", " Premium "], "notes": "Calm spacing"},
    )
    assert res.status_code == 201
    ref = res.json()
    assert ref["url"] == "https://example.com/"
    assert ref["name"] == "example.com"
    assert ref["tags"] == ["minimal", "premium"]
    assert ref["capture_status"] == "pending"

    _drain_jobs()
    listed = authed_client.get("/api/v1/website-references").json()
    assert listed[0]["capture_status"] == "captured" and listed[0]["has_screenshot"] is True
    img = authed_client.get(f"/api/v1/website-references/{ref['id']}/screenshot")
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    # Browsing/refetching the image never re-captures the site.
    authed_client.get("/api/v1/website-references")
    authed_client.get(f"/api/v1/website-references/{ref['id']}/screenshot")
    assert capture_ok == ["https://example.com/"]
    assert authed_client.get(
        f"/api/v1/website-references/{ref['id']}/screenshot", headers={"If-None-Match": img.headers["etag"]}
    ).status_code == 304


def test_failed_capture_keeps_usable_entry_and_retry_is_explicit_and_deduped(authed_client, capture_fail):
    ref = authed_client.post("/api/v1/website-references", json={"url": "https://blocked.example"}).json()
    _drain_jobs()
    ref = authed_client.get("/api/v1/website-references").json()[0]
    assert ref["capture_status"] == "failed" and "timeout" in ref["capture_error"]
    assert ref["has_screenshot"] is False
    assert authed_client.get(f"/api/v1/website-references/{ref['id']}/screenshot").status_code == 404

    authed_client.post(f"/api/v1/website-references/{ref['id']}/capture")
    authed_client.post(f"/api/v1/website-references/{ref['id']}/capture")  # double click
    from app.modules.jobs.models import Job
    from app.db.session import SessionLocal

    db = SessionLocal()
    pending = [j for j in db.query(Job).filter(Job.job_type == "website_reference_capture").all() if j.status.value == "pending"]
    assert len(pending) == 1


@pytest.mark.parametrize(
    "url",
    ["http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5/x", "ftp://example.com", "http://[::1]/", "https://intranet.local", "https://user:pw@example.com"],
)
def test_unsafe_urls_are_rejected_at_save(authed_client, url):
    assert authed_client.post("/api/v1/website-references", json={"url": url}).status_code == 400


def test_capture_guard_rejects_private_targets_before_browsing():
    import asyncio

    result = asyncio.run(browser.capture_reference_screenshot("http://169.254.169.254/latest/meta-data"))
    assert result.screenshot_jpeg is None and "isn't public" in result.error


def test_duplicate_normalised_url_is_refused(authed_client, capture_ok):
    authed_client.post("/api/v1/website-references", json={"url": "https://www.example.com/work/"})
    res = authed_client.post("/api/v1/website-references", json={"url": "http://example.com/work#top"})
    # Different scheme is a different address; same scheme+host+path collapses.
    assert res.status_code in (201, 409)
    res = authed_client.post("/api/v1/website-references", json={"url": "https://example.com/work"})
    assert res.status_code == 409


def test_edit_search_and_tag_filter(authed_client, capture_ok):
    a = authed_client.post("/api/v1/website-references", json={"url": "https://a.example", "name": "Harbour Bistro", "tags": ["hospitality"]}).json()
    authed_client.post("/api/v1/website-references", json={"url": "https://b.example", "name": "Studio Mono", "tags": ["minimal"]})
    authed_client.patch(f"/api/v1/website-references/{a['id']}", json={"name": "Harbour Bistro (dark)", "tags": ["hospitality", "bold"]})
    assert [r["name"] for r in authed_client.get("/api/v1/website-references", params={"q": "bistro"}).json()] == ["Harbour Bistro (dark)"]
    assert [r["name"] for r in authed_client.get("/api/v1/website-references", params={"tag": "minimal"}).json()] == ["Studio Mono"]


def test_workspace_isolation(authed_client, other_authed_client, capture_ok):
    ref = authed_client.post("/api/v1/website-references", json={"url": "https://private.example"}).json()
    assert other_authed_client.get("/api/v1/website-references").json() == []
    assert other_authed_client.patch(f"/api/v1/website-references/{ref['id']}", json={"name": "x"}).status_code == 404
    assert other_authed_client.get(f"/api/v1/website-references/{ref['id']}/screenshot").status_code == 404
    other_plan = _lead_and_plan(other_authed_client, "Other Biz")
    assert other_authed_client.post(f"/api/v1/planning/{other_plan['id']}/references", json={"reference_id": ref["id"]}).status_code == 404


def test_same_reference_on_two_plans_with_independent_direction(authed_client, capture_ok):
    ref = authed_client.post("/api/v1/website-references", json={"url": "https://shared.example", "notes": "Shared note"}).json()
    p1 = _lead_and_plan(authed_client, "Plan One")
    p2 = _lead_and_plan(authed_client, "Plan Two")
    b1 = authed_client.post(f"/api/v1/planning/{p1['id']}/references", json={"reference_id": ref["id"]}).json()
    authed_client.post(f"/api/v1/planning/{p1['id']}/references", json={"reference_id": ref["id"]})  # idempotent
    b2 = authed_client.post(f"/api/v1/planning/{p2['id']}/references", json={"reference_id": ref["id"]}).json()
    a1 = b1["inspiration_references"][0]["id"]
    a2 = b2["inspiration_references"][0]["id"]
    authed_client.patch(f"/api/v1/planning/{p1['id']}/references/{a1}", json={"direction": "Use the spacious layout, not the colours", "liked_aspects": ["layout"]})
    authed_client.patch(f"/api/v1/planning/{p2['id']}/references/{a2}", json={"direction": "Only the typography", "liked_aspects": ["typography"]})

    r1 = authed_client.get(f"/api/v1/planning/{p1['id']}").json()["inspiration_references"]
    r2 = authed_client.get(f"/api/v1/planning/{p2['id']}").json()["inspiration_references"]
    assert len(r1) == 1 and r1[0]["direction"].startswith("Use the spacious") and r1[0]["liked_aspects"] == ["layout"]
    assert r2[0]["direction"] == "Only the typography" and r2[0]["reference"]["notes"] == "Shared note"
    assert r1[0]["reference"]["usage_count"] == 2

    # Removing from one plan leaves the library item and the other plan intact.
    authed_client.delete(f"/api/v1/planning/{p1['id']}/references/{a1}")
    assert authed_client.get(f"/api/v1/planning/{p1['id']}").json()["inspiration_references"] == []
    assert len(authed_client.get("/api/v1/website-references").json()) == 1
    assert len(authed_client.get(f"/api/v1/planning/{p2['id']}").json()["inspiration_references"]) == 1

    # In use: hard delete refused; archive hides it from the library but keeps the plan's attachment.
    assert authed_client.delete(f"/api/v1/website-references/{ref['id']}").status_code == 409
    authed_client.post(f"/api/v1/website-references/{ref['id']}/archive")
    assert authed_client.get("/api/v1/website-references").json() == []
    assert len(authed_client.get(f"/api/v1/planning/{p2['id']}").json()["inspiration_references"]) == 1
    assert authed_client.post(f"/api/v1/planning/{p1['id']}/references", json={"reference_id": ref["id"]}).status_code == 400


def test_references_reach_build_brief_and_handoff_narrative(authed_client, capture_ok, monkeypatch):
    from tests.test_planning import _create_lead, _start_and_analyse

    lead = _create_lead(authed_client)
    plan = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    ref = authed_client.post("/api/v1/website-references", json={"url": "https://inspo.example", "name": "Inspo Co"}).json()
    body = authed_client.post(f"/api/v1/planning/{plan['id']}/references", json={"reference_id": ref["id"]}).json()
    aid = body["inspiration_references"][0]["id"]
    authed_client.patch(f"/api/v1/planning/{plan['id']}/references/{aid}", json={"direction": "Spacious layout", "liked_aspects": ["layout"]})

    brief = authed_client.get(f"/api/v1/planning/{plan['id']}/build-brief").json()
    assert brief["inspiration_references"][0]["reference"]["url"] == "https://inspo.example/"
    authed_client.post(f"/api/v1/planning/{plan['id']}/build-brief/approve")
    project = authed_client.post(f"/api/v1/planning/{plan['id']}/create-project").json()
    assert "Inspo Co (https://inspo.example/) — likes: layout — direction: Spacious layout" in project["build_direction"]
    assert "don't copy" in project["build_direction"]


def test_real_browser_blocks_redirect_to_internal_address(monkeypatch):
    """End-to-end with real Chromium: a host treated as public for the test
    (a local server) redirects to 127.0.0.1 — the redirect hop must be aborted and
    the internal page never requested."""
    import asyncio
    import http.server
    import threading

    hits = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits.append((self.headers.get("Host"), self.path))
            if self.path == "/":
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{port}/secret")
                self.end_headers()
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"internal")

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        real_public_ip_for = browser._public_ip_for

        def fake_public_ip_for(hostname, cache):
            # Stand-in for a public host that the request layer can resolve
            # offline; the redirect target 127.0.0.1 still goes through the
            # real check and must be refused.
            return "127.0.0.1" if hostname == "localhost" else real_public_ip_for(hostname, cache)

        monkeypatch.setattr(browser, "_check_url_is_public", lambda url: None)
        monkeypatch.setattr(browser, "_public_ip_for", fake_public_ip_for)
        result = asyncio.run(browser.capture_reference_screenshot(f"http://localhost:{port}/"))
    finally:
        server.shutdown()

    assert result.screenshot_jpeg is None
    assert "non-public" in result.error
    assert [path for _, path in hits] == ["/"]  # /secret was never requested


def test_real_browser_follows_safe_redirect_and_captures(monkeypatch):
    import asyncio
    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path == "/":
                self.send_response(301)
                self.send_header("Location", "/home/")
                self.end_headers()
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<html><head><title>ok</title></head><body><h1>Reference</h1></body></html>")

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        real = browser._public_ip_for
        monkeypatch.setattr(browser, "_check_url_is_public", lambda url: None)
        monkeypatch.setattr(
            browser, "_public_ip_for", lambda h, c: "127.0.0.1" if h == "localhost" else real(h, c)
        )
        result = asyncio.run(browser.capture_reference_screenshot(f"http://localhost:{port}/"))
    finally:
        server.shutdown()
    assert result.error is None and result.screenshot_jpeg and result.screenshot_jpeg[:2] == b"\xff\xd8"
