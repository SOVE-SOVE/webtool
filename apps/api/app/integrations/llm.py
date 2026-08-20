"""
The one Claude adapter — every agent calls the LLM through here, never
through its own client code, per docs/02_ARCHITECTURE.md §6.
"""

import anthropic

from app.core.settings import settings

_TOOL_NAME = "emit_result"


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

    client = anthropic.Anthropic(api_key=settings.llm_api_key)
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
        raise LlmUnavailableError(
            f"AI generation is unavailable — the Claude API returned {exc.status_code} "
            f"(check the API key, credit balance, and rate limits). Nothing was generated or saved."
        ) from exc
    except anthropic.APIError as exc:
        raise LlmUnavailableError(
            f"AI generation is unavailable — couldn't reach the Claude API ({exc}). Nothing was generated or saved."
        ) from exc

    for block in response.content:
        if block.type == "tool_use" and block.name == _TOOL_NAME:
            return block.input

    raise LlmUnavailableError(
        "AI generation is unavailable — the Claude API returned an unusable response. Nothing was generated or saved."
    )
