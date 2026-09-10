"""
Historical import path for `LlmUnavailableError`. As of T5 no code calls
an LLM through this module — every agent routes an AITask through
app.integrations.ai.router. This file is kept only so
`from app.integrations.llm import LlmUnavailableError` keeps working for
app.main and app.modules.planning.service (the FastAPI exception
handler is registered against that class). The error type itself lives
in app.integrations.errors; the Anthropic call lives in
app.integrations.ai.providers.anthropic_provider.

Do not add a `generate_structured` here — use the router.
"""

from app.integrations.errors import LlmUnavailableError

__all__ = ["LlmUnavailableError"]
