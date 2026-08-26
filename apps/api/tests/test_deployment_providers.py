"""
Coverage for the adapter architecture itself (phase 6 part 2, Task 1):
the shared static build step, and each real provider's request
construction / response handling — credential gating, a successful
publish, and a clean (never-raised) failure on a network error or a
non-2xx response. Mirrors tests/test_email_integration.py's
`monkeypatch.setattr("httpx.post", ...)` pattern for
ResendEmailProvider, the one other real adapter in this codebase.

None of these ever reach a real network — every HTTP/FTP call is
monkeypatched, same as the rest of this app's provider tests.
"""

import httpx
import pytest

from app.integrations.deployment.base import DeploymentBundle, DeploymentProviderError


_ONE_PAGE_CONFIG = {
    "navigation": {"config": {"links": [{"label": "Home", "href": "/"}]}},
    "footer": {"config": {"text": "© Riverside Plumbing"}},
    "pages": [
        {
            "slug": "",
            "name": "Home",
            "seo": {"title": "Riverside Plumbing", "meta_description": "Local plumbers."},
            "sections": [
                {
                    "type": "hero",
                    "config": {
                        "heading": "Fast, reliable plumbing",
                        "subheading": "Serving Ipswich since 2011.",
                        "primaryCta": {"label": "Get a quote", "href": "/contact"},
                    },
                }
            ],
        },
        {
            "slug": "contact",
            "name": "Contact",
            "seo": {"title": "Contact"},
            "sections": [{"type": "contact", "config": {"heading": "Get in touch"}}],
        },
    ],
}


def _bundle(**overrides) -> DeploymentBundle:
    defaults = dict(business_slug="Riverside Plumbing", environment="production", config=_ONE_PAGE_CONFIG)
    defaults.update(overrides)
    return DeploymentBundle(**defaults)


class TestBuildStaticSite:
    def test_builds_one_html_file_per_page_plus_a_stylesheet(self):
        from app.integrations.deployment.build import build_static_site

        artifact = build_static_site(_bundle())
        assert artifact.ok is True
        assert set(artifact.files) == {"index.html", "contact/index.html", "assets/styles.css"}
        assert artifact.entry_page == "index.html"
        assert "Fast, reliable plumbing" in artifact.files["index.html"]
        assert "Get a quote" in artifact.files["index.html"]
        assert "<title>Riverside Plumbing</title>" in artifact.files["index.html"]

    def test_escapes_content_rather_than_injecting_it_raw(self):
        from app.integrations.deployment.build import build_static_site

        bundle = _bundle(
            config={
                "pages": [
                    {
                        "slug": "",
                        "seo": {"title": "Home"},
                        "sections": [{"type": "hero", "config": {"heading": "<script>alert(1)</script>"}}],
                    }
                ]
            }
        )
        artifact = build_static_site(bundle)
        assert "<script>alert(1)</script>" not in artifact.files["index.html"]
        assert "&lt;script&gt;" in artifact.files["index.html"]

    def test_fails_cleanly_with_no_pages(self):
        from app.integrations.deployment.build import build_static_site

        artifact = build_static_site(_bundle(config={"pages": []}))
        assert artifact.ok is False
        assert artifact.error is not None


class TestVercelProvider:
    def test_factory_raises_without_a_token(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.deployment.vercel_provider import get_vercel_provider

        monkeypatch.setattr(settings, "vercel_api_token", "")
        with pytest.raises(DeploymentProviderError):
            get_vercel_provider()

    def test_deploy_without_a_project_name_fails_cleanly(self):
        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.vercel_provider import VercelProvider

        provider = VercelProvider("test-token")
        bundle = _bundle()
        outcome = provider.deploy(bundle, build_static_site(bundle))
        assert outcome.ok is False
        assert "project name" in outcome.error

    def test_a_network_error_is_returned_as_a_failed_outcome_not_raised(self, monkeypatch):
        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.vercel_provider import VercelProvider

        monkeypatch.setattr("httpx.post", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("refused")))
        provider = VercelProvider("test-token")
        bundle = _bundle(project_config={"project_name": "riverside-plumbing"})
        outcome = provider.deploy(bundle, build_static_site(bundle))
        assert outcome.ok is False
        assert "refused" in outcome.error

    def test_a_successful_response_returns_the_url_and_provider_ref(self, monkeypatch):
        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.vercel_provider import VercelProvider

        class _Resp:
            status_code = 200

            def json(self):
                return {"id": "dpl_abc123", "url": "riverside-plumbing.vercel.app", "readyState": "READY"}

        monkeypatch.setattr("httpx.post", lambda *a, **k: _Resp())
        provider = VercelProvider("test-token")
        bundle = _bundle(project_config={"project_name": "riverside-plumbing"})
        outcome = provider.deploy(bundle, build_static_site(bundle))
        assert outcome.ok is True
        assert outcome.url == "https://riverside-plumbing.vercel.app"
        assert outcome.provider_ref == "dpl_abc123"

    def test_get_status_maps_ready_state_to_normalized_states(self, monkeypatch):
        from app.integrations.deployment.vercel_provider import VercelProvider

        class _Resp:
            status_code = 200

            def json(self):
                return {"readyState": "BUILDING", "url": "riverside-plumbing.vercel.app"}

        monkeypatch.setattr("httpx.get", lambda *a, **k: _Resp())
        status = VercelProvider("test-token").get_status("dpl_abc123")
        assert status.state == "building"


class TestNetlifyProvider:
    def test_factory_raises_without_site_id(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.deployment.netlify_provider import get_netlify_provider

        monkeypatch.setattr(settings, "netlify_api_token", "test-token")
        monkeypatch.setattr(settings, "netlify_site_id", "")
        with pytest.raises(DeploymentProviderError):
            get_netlify_provider()

    def test_a_non_2xx_response_is_returned_as_a_failed_outcome(self, monkeypatch):
        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.netlify_provider import NetlifyProvider

        class _Resp:
            status_code = 401
            text = "Unauthorized"

        monkeypatch.setattr("httpx.put", lambda *a, **k: _Resp())
        provider = NetlifyProvider("bad-token", "site-123")
        bundle = _bundle()
        outcome = provider.deploy(bundle, build_static_site(bundle))
        assert outcome.ok is False
        assert "401" in outcome.error

    def test_a_successful_zip_deploy_returns_the_ssl_url(self, monkeypatch):
        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.netlify_provider import NetlifyProvider

        class _Resp:
            status_code = 200

            def json(self):
                return {"id": "deploy-abc", "ssl_url": "https://riverside-plumbing.netlify.app", "state": "ready"}

        monkeypatch.setattr("httpx.put", lambda *a, **k: _Resp())
        provider = NetlifyProvider("test-token", "site-123")
        bundle = _bundle()
        outcome = provider.deploy(bundle, build_static_site(bundle))
        assert outcome.ok is True
        assert outcome.url == "https://riverside-plumbing.netlify.app"
        assert outcome.provider_ref == "deploy-abc"

    def test_rollback_restores_a_prior_deploy(self, monkeypatch):
        from app.integrations.deployment.netlify_provider import NetlifyProvider

        class _Resp:
            status_code = 200

            def json(self):
                return {"id": "deploy-old", "ssl_url": "https://riverside-plumbing.netlify.app"}

        monkeypatch.setattr("httpx.post", lambda *a, **k: _Resp())
        outcome = NetlifyProvider("test-token", "site-123").rollback("deploy-old")
        assert outcome.ok is True
        assert outcome.provider_ref == "deploy-old"


class TestCloudflareProvider:
    def test_factory_raises_without_full_config(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.deployment.cloudflare_provider import get_cloudflare_provider

        monkeypatch.setattr(settings, "cloudflare_api_token", "test-token")
        monkeypatch.setattr(settings, "cloudflare_account_id", "")
        monkeypatch.setattr(settings, "cloudflare_pages_project", "riverside-plumbing")
        with pytest.raises(DeploymentProviderError):
            get_cloudflare_provider()

    def test_a_reported_failure_is_returned_as_a_failed_outcome(self, monkeypatch):
        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.cloudflare_provider import CloudflareProvider

        class _Resp:
            status_code = 200

            def json(self):
                return {"success": False, "errors": [{"message": "project not found"}]}

        monkeypatch.setattr("httpx.post", lambda *a, **k: _Resp())
        provider = CloudflareProvider("test-token", "account-123", "riverside-plumbing")
        bundle = _bundle()
        outcome = provider.deploy(bundle, build_static_site(bundle))
        assert outcome.ok is False
        assert "project not found" in outcome.error

    def test_a_successful_response_returns_the_url(self, monkeypatch):
        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.cloudflare_provider import CloudflareProvider

        class _Resp:
            status_code = 200

            def json(self):
                return {"success": True, "result": {"id": "cf-dep-1", "url": "https://riverside-plumbing.pages.dev"}}

        monkeypatch.setattr("httpx.post", lambda *a, **k: _Resp())
        provider = CloudflareProvider("test-token", "account-123", "riverside-plumbing")
        bundle = _bundle()
        outcome = provider.deploy(bundle, build_static_site(bundle))
        assert outcome.ok is True
        assert outcome.url == "https://riverside-plumbing.pages.dev"
        assert outcome.provider_ref == "cf-dep-1"


class _FakeFTP:
    """Records every call instead of touching a real socket — enough
    surface for TraditionalHostingProvider's upload loop."""

    instances: list["_FakeFTP"] = []

    def __init__(self):
        self.uploaded: dict[str, bytes] = {}
        self.cwd_calls: list[str] = []
        self.quit_called = False
        _FakeFTP.instances.append(self)

    def connect(self, host, port, timeout=None):
        self.host, self.port = host, port

    def login(self, username, password):
        self.username, self.password = username, password

    def cwd(self, path):
        self.cwd_calls.append(path)

    def mkd(self, path):
        pass

    def storbinary(self, cmd, fileobj):
        _, filename = cmd.split(" ", 1)
        self.uploaded[filename] = fileobj.read()

    def quit(self):
        self.quit_called = True


class TestTraditionalHostingProvider:
    def test_factory_raises_without_full_config(self, monkeypatch):
        from app.core.settings import settings
        from app.integrations.deployment.traditional_provider import get_traditional_provider

        monkeypatch.setattr(settings, "traditional_hosting_host", "")
        with pytest.raises(DeploymentProviderError):
            get_traditional_provider()

    def test_deploy_uploads_every_build_file_and_returns_the_configured_base_url(self, monkeypatch):
        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.traditional_provider import TraditionalHostingProvider

        _FakeFTP.instances = []
        monkeypatch.setattr("ftplib.FTP", _FakeFTP)
        provider = TraditionalHostingProvider(
            "ftp.example.com", "user", "pass", "https://riverside-plumbing.example.com", use_tls=False
        )
        bundle = _bundle()
        artifact = build_static_site(bundle)
        outcome = provider.deploy(bundle, artifact)

        assert outcome.ok is True
        assert outcome.url == "https://riverside-plumbing.example.com"
        assert outcome.detail["files_uploaded"] == len(artifact.files)
        uploaded_names = {name for ftp in _FakeFTP.instances for name in ftp.uploaded}
        assert "index.html" in uploaded_names
        assert "styles.css" in uploaded_names

    def test_a_connection_failure_is_returned_as_a_failed_outcome_not_raised(self, monkeypatch):
        import ftplib

        from app.integrations.deployment.build import build_static_site
        from app.integrations.deployment.traditional_provider import TraditionalHostingProvider

        class _RefusingFTP(_FakeFTP):
            def connect(self, host, port, timeout=None):
                raise ftplib.error_temp("connection refused")

        monkeypatch.setattr("ftplib.FTP", _RefusingFTP)
        provider = TraditionalHostingProvider("ftp.example.com", "user", "pass", "https://example.com", use_tls=False)
        bundle = _bundle()
        outcome = provider.deploy(bundle, build_static_site(bundle))
        assert outcome.ok is False
        assert "connection refused" in outcome.error
