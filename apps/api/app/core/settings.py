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

    log_level: str = "INFO"

    # llm — Claude API, the one adapter per docs/02_ARCHITECTURE.md §6.
    # Blank is fine for tests (integrations.llm is mocked there); a real
    # sales-audit generation call fails fast without it.
    llm_api_key: str = ""
    llm_model: str = "claude-sonnet-5"

    # brave search — optional. When unset, the sales-audit search step is
    # skipped (not faked) rather than the app failing to start.
    brave_search_api_key: str | None = None

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

    # deployment — which provider modules/deployments/service.py
    # publishes through (see app/integrations/deployment.py). Only
    # "mock" is implemented today; no real hosting account exists yet.
    deploy_provider: str = "mock"

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
