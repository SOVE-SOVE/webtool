"""
Provider health checks (T7). Answers "can the app actually reach its
configured AI providers, and is the local model installed" — for the
Settings status panel and for turning "AI generation failed" into
something actionable.

Rules:
  - The app NEVER downloads a model. A missing local model reports
    "not installed" plus the name to pull; it does not fix it.
  - The Anthropic check never spends tokens — it lists models (a free,
    unmetered call) only, and only when a key is configured.
  - Every check is bounded by a short timeout and returns a structured
    result instead of raising.
"""

from dataclasses import dataclass, field

import anthropic
import httpx

from app.core.settings import settings

# Deliberately short — this is a status probe, not a generation call.
_PROBE_TIMEOUT_SECONDS = 5.0


def _model_installed(model: str, installed_names: list[str]) -> bool:
    """`ai_local_model` may be given with an explicit tag ('qwen3:30b-a3b')
    or bare ('llama3.2', which Ollama stores as 'llama3.2:latest')."""
    if model in installed_names:
        return True
    if f"{model}:latest" in installed_names:
        return True
    return any(name.split(":", 1)[0] == model for name in installed_names)


@dataclass
class ProviderHealth:
    provider: str
    configured: bool
    ok: bool
    detail: str
    # Local only:
    model: str | None = None
    model_installed: bool | None = None
    can_generate: bool | None = None
    installed_models: list[str] = field(default_factory=list)


def check_local(*, probe_generation: bool = False) -> ProviderHealth:
    provider = settings.ai_local_provider
    model = settings.ai_local_model

    if provider != "ollama":
        return ProviderHealth(
            provider=provider, configured=False, ok=False, model=model,
            detail=f"Unsupported AI_LOCAL_PROVIDER {provider!r} — only 'ollama' is implemented.",
        )

    base_url = settings.ollama_base_url.rstrip("/")
    try:
        resp = httpx.get(f"{base_url}/api/tags", timeout=_PROBE_TIMEOUT_SECONDS)
        resp.raise_for_status()
        names = [m.get("name", "") for m in (resp.json().get("models") or [])]
    except httpx.TimeoutException:
        return ProviderHealth(
            provider=provider, configured=True, ok=False, model=model,
            detail=f"Ollama at {base_url} did not respond within {_PROBE_TIMEOUT_SECONDS:g}s.",
        )
    except httpx.HTTPError as exc:
        return ProviderHealth(
            provider=provider, configured=True, ok=False, model=model,
            detail=f"Can't reach Ollama at {base_url}. Is it running? ({type(exc).__name__})",
        )

    if not _model_installed(model, names):
        return ProviderHealth(
            provider=provider, configured=True, ok=False, model=model, model_installed=False,
            installed_models=names,
            detail=f"Local AI model is not installed. Install it with: ollama pull {model}",
        )

    if not probe_generation:
        return ProviderHealth(
            provider=provider, configured=True, ok=True, model=model, model_installed=True,
            installed_models=names, detail="Connected",
        )

    # Deep check: a 1-token generation to confirm the model actually loads
    # and responds. Kept tiny; still bounded by the probe timeout.
    try:
        gen = httpx.post(
            f"{base_url}/v1/chat/completions",
            json={
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
            },
            timeout=max(_PROBE_TIMEOUT_SECONDS, settings.ollama_timeout_seconds),
        )
        gen.raise_for_status()
    except httpx.HTTPError as exc:
        return ProviderHealth(
            provider=provider, configured=True, ok=False, model=model, model_installed=True,
            can_generate=False, installed_models=names,
            detail=f"{model} is installed but did not generate ({type(exc).__name__}).",
        )
    return ProviderHealth(
        provider=provider, configured=True, ok=True, model=model, model_installed=True,
        can_generate=True, installed_models=names, detail="Connected",
    )


def check_premium(*, probe_reachability: bool = False) -> ProviderHealth:
    provider = settings.ai_premium_provider
    model = settings.ai_premium_model or settings.llm_model

    if provider != "anthropic":
        return ProviderHealth(
            provider=provider, configured=False, ok=False, model=model,
            detail=f"Unsupported AI_PREMIUM_PROVIDER {provider!r} — only 'anthropic' is implemented.",
        )
    if not settings.llm_api_key:
        return ProviderHealth(
            provider=provider, configured=False, ok=False, model=model,
            detail="Not configured — set LLM_API_KEY.",
        )
    if not probe_reachability:
        return ProviderHealth(provider=provider, configured=True, ok=True, model=model, detail="Configured")

    # Free, unmetered call — never a generation. Confirms the key works
    # and the API is reachable without spending tokens.
    try:
        client = anthropic.Anthropic(api_key=settings.llm_api_key, timeout=_PROBE_TIMEOUT_SECONDS)
        client.models.list()
    except anthropic.AuthenticationError:
        return ProviderHealth(
            provider=provider, configured=True, ok=False, model=model,
            detail="LLM_API_KEY is set but was rejected by the Claude API.",
        )
    except anthropic.APIError as exc:
        return ProviderHealth(
            provider=provider, configured=True, ok=False, model=model,
            detail=f"Couldn't reach the Claude API ({type(exc).__name__}).",
        )
    return ProviderHealth(provider=provider, configured=True, ok=True, model=model, detail="Connected")
