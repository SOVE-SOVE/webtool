"""
The one Claude adapter — every agent calls the LLM through here, never
through its own client code, per docs/02_ARCHITECTURE.md §6.
"""

import logging
from typing import TypeVar

import anthropic
import pydantic

from app.core.settings import settings

logger = logging.getLogger("app")

_TOOL_NAME = "emit_result"

# The SDK's own defaults (10 minute timeout, 2 retries on top of that) are
# tuned for long-running batch/async use, not a synchronous FastAPI route
# handler — an unresponsive Claude API could otherwise tie up a request
# thread for up to ~30 minutes. Both are still generous for an
# interactive request, just bounded.
_REQUEST_TIMEOUT_SECONDS = 90.0
_MAX_RETRIES = 2

_ModelT = TypeVar("_ModelT", bound=pydantic.BaseModel)


class LlmUnavailableError(RuntimeError):
    """
    The generation could not happen at all — no API key configured, no
    credit/quota left, the API refused or was unreachable, or it
    answered with something unusable. Distinct from an ordinary bug so
    app/main.py can turn it into a 503 the operator can act on instead
    of an opaque "Internal server error": the honest answer is "this
    couldn't be generated, here's why", never a fabricated result.
    """


def generate_structured(
    system: str,
    user: str,
    schema: dict,
    model: str | None = None,
    max_tokens: int = 4096,
) -> dict:
    """
    Calls Claude with a forced tool-call matching `schema`, so the result
    is parsed JSON rather than something regex'd out of markdown. Every
    failure mode surfaces as `LlmUnavailableError` — nothing is faked or
    partially stored, per docs/03_AGENT_RULES.md.
    """
    if not settings.llm_api_key:
        raise LlmUnavailableError(
            "AI generation is unavailable — no Claude API key is configured (set LLM_API_KEY). "
            "Nothing was generated or saved."
        )

    client = anthropic.Anthropic(
        api_key=settings.llm_api_key,
        timeout=_REQUEST_TIMEOUT_SECONDS,
        max_retries=_MAX_RETRIES,
    )
    try:
        response = client.messages.create(
            model=model or settings.llm_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            tools=[
                {
                    "name": _TOOL_NAME,
                    "description": "Return the result in this exact structure.",
                    "input_schema": schema,
                }
            ],
            tool_choice={"type": "tool", "name": _TOOL_NAME},
        )
    except anthropic.APIStatusError as exc:
        logger.error("Claude API returned %s: %s", exc.status_code, exc)
        raise LlmUnavailableError(
            f"AI generation is unavailable — the Claude API returned {exc.status_code} "
            f"(check the API key, credit balance, and rate limits). Nothing was generated or saved."
        ) from exc
    except anthropic.APIError as exc:
        logger.error("Could not reach the Claude API: %s", exc)
        raise LlmUnavailableError(
            f"AI generation is unavailable — couldn't reach the Claude API ({exc}). Nothing was generated or saved."
        ) from exc

    if response.stop_reason == "max_tokens":
        logger.error("Claude response truncated at max_tokens=%d", max_tokens)
        raise LlmUnavailableError(
            "AI generation is unavailable — the response was too long and got cut off. Nothing was generated or saved."
        )

    for block in response.content:
        if block.type == "tool_use" and block.name == _TOOL_NAME:
            return block.input

    logger.error("Claude response had no usable tool_use block (stop_reason=%s)", response.stop_reason)
    raise LlmUnavailableError(
        "AI generation is unavailable — the Claude API returned an unusable response. Nothing was generated or saved."
    )


def parse_structured_output(model_cls: type[_ModelT], raw: dict) -> _ModelT:
    """
    Every agent calls this right after `generate_structured` to validate
    Claude's output against its own typed schema. Centralized here (not
    duplicated per-agent) so a malformed response — the model omitted a
    required field, used the wrong type, etc. — degrades to the same
    clean `LlmUnavailableError` -> 503 path as every other "couldn't
    generate this" case, instead of an uncaught `pydantic.ValidationError`
    surfacing as a raw 500.
    """
    try:
        return model_cls.model_validate(raw)
    except pydantic.ValidationError as exc:
        logger.error("Claude output failed %s validation: %s", model_cls.__name__, exc)
        raise LlmUnavailableError(
            "AI generation is unavailable — the AI's response didn't match the expected structure. "
            "Nothing was generated or saved."
        ) from exc
