from pydantic import BaseModel


class ProviderStatus(BaseModel):
    provider: str  # "ollama" | "anthropic"
    configured: bool
    ok: bool
    detail: str  # short, human-readable — e.g. "Connected", "Configured", or the problem
    model: str | None = None
    model_installed: bool | None = None  # local only
    can_generate: bool | None = None  # local only, populated when probe=true
    installed_models: list[str] = []  # local only


class AiProvidersStatus(BaseModel):
    local: ProviderStatus
    premium: ProviderStatus
    probed: bool  # whether the live reachability/generation probe was run
