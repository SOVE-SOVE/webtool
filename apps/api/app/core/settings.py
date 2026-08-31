from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Signing keys that are public knowledge (this file, .env.example) or
# trivially guessable. A session cookie is only a signed user id, so
# whoever knows the key can mint a valid session for any user without a
# password — see app/core/auth.py.
_SESSION_SECRET_MIN_LENGTH = 32
_UNSAFE_SESSION_SECRETS = {"", "change-me-in-.env", "changeme", "secret", "dev", "test"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # database
    database_url: str = "postgresql+psycopg://webdesignos:webdesignos@localhost:5432/webdesignos"

    # auth — sessions are DB-backed (users table) as of the workspace/
    # multi-user change, see docs/05_DECISIONS.md. These seed_* values
    # are only read by `python -m app.core.seed` to bootstrap the first
    # workspace + admin user; they are not checked at request time.
    seed_workspace_name: str = "Default Workspace"
    seed_admin_name: str = "Admin"
    seed_admin_email: str = "operator@example.com"
    seed_admin_password_hash: str = ""
    session_secret: str = "change-me-in-.env"
    session_cookie_name: str = "wdos_session"
    session_max_age_seconds: int = 60 * 60 * 24 * 14  # 2 weeks
    # False for local http dev, True in production (set via .env)
    session_cookie_secure: bool = False

    # cors — the web app's origin(s), comma-separated
    allowed_origins: str = "http://localhost:3000"

    # The web app's own public origin — used to build a shareable
    # preview URL (modules/previews/) server-side, since the API is the
    # one place that mints the token. Deliberately separate from
    # allowed_origins (CORS can list several; a shareable link needs
    # exactly one canonical one).
    app_base_url: str = "http://localhost:3000"

    log_level: str = "INFO"

    # llm — Claude API, the one adapter per docs/02_ARCHITECTURE.md §6.
    # Blank is fine for tests (integrations.llm is mocked there); a real
    # sales-audit generation call fails fast without it.
    llm_api_key: str = ""
    llm_model: str = "claude-sonnet-5"

    # brave search — optional. When unset, the sales-audit search step is
    # skipped (not faked) rather than the app failing to start.
    brave_search_api_key: str | None = None

    # google places — optional. Powers the "google_places" discovery
    # provider (a real business/places source, unlike Brave web search).
    # When unset that provider reports itself unavailable; discovery
    # falls back to Brave. Never sent to the browser — the provider runs
    # server-side only.
    google_places_api_key: str | None = None

    # Cap on paid-API-triggering generations (sales audit, outreach
    # draft, follow-up suggestion, meeting brief) per user —
    # docs/06_SECURITY.md's "cost/rate limits on paid APIs" control. See
    # app/core/rate_limit.py.
    llm_rate_limit_per_minute: int = 10

    # google calendar — one OAuth app for the whole product; each user
    # individually connects their own calendar from Settings (see
    # modules/calendar/). Blank client_id/secret means the connect
    # button returns a clear "not configured" error rather than the app
    # failing to start, matching the brave_search_api_key pattern below.
    google_calendar_client_id: str = ""
    google_calendar_client_secret: str = ""
    google_calendar_redirect_uri: str = "http://localhost:8000/api/v1/calendar/google/callback"
    # Fernet key (python -c "from cryptography.fernet import Fernet;
    # print(Fernet.generate_key().decode())") — encrypts the stored
    # refresh token at rest. See app/core/crypto.py and
    # docs/06_SECURITY.md: never store an OAuth token in plaintext.
    calendar_token_encryption_key: str = ""
    # Which adapter modules/meetings/service.py syncs calendar events
    # through — see app/integrations/calendar/registry.py. Defaults to
    # "google" (the real integration above, itself gated on whether a
    # user has actually connected their calendar) to preserve existing
    # behavior; set to "mock" for local dev/tests without a real Google
    # account — see integrations/calendar/mock_provider.py.
    calendar_provider: str = "google"

    # deployment — which provider modules/deployments/service.py
    # publishes through (see app/integrations/deployment/registry.py).
    # "mock" (default, safe for dev/tests, never makes a network call),
    # or "vercel"/"netlify"/"cloudflare"/"traditional" — each real
    # provider's factory fails loudly if its own credentials below
    # aren't set, rather than silently deploying through mock instead.
    # No real hosting account is configured for this app today; these
    # exist as the adapter architecture's real extension points, not as
    # a claim that a real deployment has ever been made through them.
    deploy_provider: str = "mock"

    # vercel — https://vercel.com/docs/rest-api. VERCEL_TEAM_ID is only
    # needed for a team-scoped token; leave blank for a personal token.
    vercel_api_token: str = ""
    vercel_project_name: str = ""
    vercel_team_id: str = ""

    # netlify — https://docs.netlify.com/api/get-started/
    netlify_api_token: str = ""
    netlify_site_id: str = ""

    # cloudflare pages — https://developers.cloudflare.com/pages/
    cloudflare_api_token: str = ""
    cloudflare_account_id: str = ""
    cloudflare_pages_project: str = ""

    # traditional hosting (FTP/FTPS) — any shared/cPanel-style host.
    # BASE_URL is the public site URL to report as the deployment's
    # url (FTP itself never returns one) — e.g. "https://example.com".
    traditional_hosting_host: str = ""
    traditional_hosting_username: str = ""
    traditional_hosting_password: str = ""
    traditional_hosting_base_url: str = ""
    traditional_hosting_port: int = 21
    traditional_hosting_remote_path: str = "/"
    traditional_hosting_use_tls: bool = True

    # email — which provider modules/outreach/service.py dispatches
    # approved EMAIL outreach through (see app/integrations/email.py).
    # "mock" (default, safe for dev/tests, never makes a network call)
    # or "resend". RESEND_API_KEY is only required when EMAIL_PROVIDER
    # is "resend" — get_email_provider() fails loudly rather than
    # silently falling back to mock if it's missing.
    email_provider: str = "mock"
    resend_api_key: str = ""
    email_from_address: str = "no-reply@example.com"

    @field_validator("session_secret")
    @classmethod
    def _reject_unsafe_session_secret(cls, value: str) -> str:
        """
        Refuse to start rather than silently signing sessions with a key
        an attacker already has. The old default was reachable three
        ways that all looked like a working app: no .env on the process's
        working directory, `cp .env.example .env` (which ships the key
        blank), or a deploy that sets every other env var but this one.
        """
        if value in _UNSAFE_SESSION_SECRETS or len(value) < _SESSION_SECRET_MIN_LENGTH:
            raise ValueError(
                "SESSION_SECRET is unset, a known placeholder, or too short. It must be at least "
                f"{_SESSION_SECRET_MIN_LENGTH} characters of random text — generate one with: "
                'python -c "import secrets; print(secrets.token_urlsafe(32))"'
            )
        return value

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
