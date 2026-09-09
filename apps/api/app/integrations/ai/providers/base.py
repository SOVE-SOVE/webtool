"""
Common AI provider interface. Every provider (Anthropic, Ollama)
implements exactly this and nothing more — per the T3 rule "do not
implement capabilities the application doesn't need": every one of the
9 existing AI call sites (see T1 audit) uses only forced-schema
structured JSON generation. No streaming, no raw tool-calling loop, no
multi-turn chat history — add those only when a real feature needs them.
"""

from typing import Protocol


class AIProvider(Protocol):
    def generate_structured(
        self,
        system: str,
        user: str,
        schema: dict,
        model: str,
        max_tokens: int = 4096,
    ) -> dict:
        """
        Returns parsed JSON matching `schema`. Raises an
        app.integrations.ai.errors.AIProviderError (or a subclass) on
        any failure — never returns a partial or fabricated result.
        """
        ...
