"""
The one Claude adapter — every agent calls the LLM through here, never
through its own client code, per docs/02_ARCHITECTURE.md §6.
"""

import anthropic

from app.core.settings import settings

_TOOL_NAME = "emit_result"


def generate_structured(
    system: str,
    user: str,
    schema: dict,
    model: str | None = None,
    max_tokens: int = 4096,
) -> dict:
    """
    Calls Claude with a forced tool-call matching `schema`, so the result
    is parsed JSON rather than something regex'd out of markdown. Raises
    on any API/transport error or a malformed tool response — callers
    (agents) are responsible for turning that into a flagged AgentResult
    rather than a 500, per docs/03_AGENT_RULES.md's "flag, don't pass
    through silently" rule.
    """
    client = anthropic.Anthropic(api_key=settings.llm_api_key)
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

    for block in response.content:
        if block.type == "tool_use" and block.name == _TOOL_NAME:
            return block.input

    raise RuntimeError("LLM response did not include the expected tool call")
