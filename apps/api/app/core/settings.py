from pydantic_settings import BaseSettings, SettingsConfigDict


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
    # draft, follow-up suggestion) per user — docs/06_SECURITY.md's
    # "cost/rate limits on paid APIs" control. See app/core/rate_limit.py.
    llm_rate_limit_per_minute: int = 10

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
