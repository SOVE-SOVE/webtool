"""
Common AI provider interface. Every provider (Anthropic, Ollama)
implements exactly this and nothing more — per the T3 rule "do not
implement capabilities the application doesn't need": every AI call
site uses only forced-schema structured JSON generation. No streaming,
no raw tool-calling loop, no multi-turn chat history — add those only
when a real feature needs them.
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass
class GenerationResult:
    """What a provider returns from `generate_structured`. `data` is the
    parsed JSON (what agents actually consume); `input_tokens` /
    `output_tokens` are the provider's own usage counts when it reports
    them (Anthropic always does; Ollama does when the server includes a
    `usage` block), left None otherwise — never estimated. Used by the
    router to write an AI usage event (T6) without the agent knowing or
    caring."""

    data: dict
    input_tokens: int | None = None
    output_tokens: int | None = None


class AIProvider(Protocol):
    def generate_structured(
        self,
        system: str,
        user: str,
        schema: dict,
        model: str,
        max_tokens: int = 4096,
    ) -> GenerationResult:
        """
        Returns a GenerationResult whose `data` matches `schema`. Raises
        an app.integrations.ai.errors.AIProviderError (or a subclass) on
        any failure — never returns a partial or fabricated result.
        """
        ...
