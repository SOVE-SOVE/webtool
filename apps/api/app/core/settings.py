from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # database
    database_url: str = "postgresql+psycopg://webdesignos:webdesignos@localhost:5432/webdesignos"

    # auth — single operator account, per docs/03_AGENT_RULES.md
    operator_email: str = "operator@example.com"
    operator_password_hash: str = ""
    session_secret: str = "change-me-in-.env"
    session_cookie_name: str = "wdos_session"
    session_max_age_seconds: int = 60 * 60 * 24 * 14  # 2 weeks
    # False for local http dev, True in production (set via .env)
    session_cookie_secure: bool = False

    # cors — the web app's origin(s), comma-separated
    allowed_origins: str = "http://localhost:3000"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
