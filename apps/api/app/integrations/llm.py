"""
The one Claude adapter — every agent calls the LLM through here, never
through its own client code, per docs/02_ARCHITECTURE.md §6.

As of the AI provider/task-routing work (T3), the actual Anthropic
call lives in app.integrations.ai.providers.anthropic_provider —
this module is now a thin, behavior-preserving wrapper around it, so
none of the existing agent call sites or their tests (which monkeypatch
`generate_structured` at each agent's own import site) need to change.
New/migrated features should prefer app.integrations.ai.router instead,
which chooses Anthropic vs. a local model per task; this module always
uses the premium/Anthropic path, as it always has.
"""

from app.core.settings import settings
from app.integrations.ai.errors import AIProviderError
from app.integrations.ai.providers.anthropic_provider import AnthropicProvider
from app.integrations.errors import LlmUnavailableError

__all__ = ["LlmUnavailableError", "generate_structured"]

_provider = AnthropicProvider()


def generate_structured(
    system: str,
    user: str,
    schema: dict,
    model: str | None = None,
    max_tokens: int = 4096,
    images_base64: list[str] | None = None,
) -> dict:
    """
    Calls Claude with a forced tool-call matching `schema`, so the result
    is parsed JSON rather than something regex'd out of markdown. Every
    failure mode surfaces as `LlmUnavailableError` — nothing is faked or
    partially stored, per docs/03_AGENT_RULES.md.

    `images_base64`, when given, attaches each image (PNG) to the user
    message ahead of the text — used by agents/planning_visual_review.py
    so the model's findings are grounded in what's actually visible in
    the screenshot, not inferred from the text description alone.
    """
    try:
        return _provider.generate_structured(
            system=system,
            user=user,
            schema=schema,
            model=model or settings.llm_model,
            max_tokens=max_tokens,
            images_base64=images_base64,
        )
    except AIProviderError as exc:
        # AIProviderError already is-a LlmUnavailableError, but re-raise
        # explicitly as the latter so `raise ... from exc` reads honestly
        # for anyone inspecting this module in isolation.
        raise LlmUnavailableError(str(exc)) from exc
