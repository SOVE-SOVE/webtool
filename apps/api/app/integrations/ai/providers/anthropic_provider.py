"""
Anthropic provider — implements AIProvider (base.py) for Claude. This is
the same tool-forcing structured-output call that used to live inline in
app/integrations/llm.py; that module now delegates here so its public
`generate_structured` function (used by all 9 existing agent call sites)
is unchanged in behavior and import path.
"""

import anthropic

from app.core.settings import settings
from app.integrations.ai.errors import AIProviderError

_TOOL_NAME = "emit_result"


class AnthropicProvider:
    def generate_structured(
        self,
        system: str,
        user: str,
        schema: dict,
        model: str,
        max_tokens: int = 4096,
    ) -> dict:
        if not settings.llm_api_key:
            raise AIProviderError(
                "AI generation is unavailable — no Claude API key is configured (set LLM_API_KEY). "
                "Nothing was generated or saved."
            )

        client = anthropic.Anthropic(api_key=settings.llm_api_key)
        try:
            response = client.messages.create(
                model=model,
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
            raise AIProviderError(
                f"AI generation is unavailable — the Claude API returned {exc.status_code} "
                f"(check the API key, credit balance, and rate limits). Nothing was generated or saved."
            ) from exc
        except anthropic.APIError as exc:
            raise AIProviderError(
                f"AI generation is unavailable — couldn't reach the Claude API ({exc}). Nothing was generated or saved."
            ) from exc

        for block in response.content:
            if block.type == "tool_use" and block.name == _TOOL_NAME:
                return block.input

        raise AIProviderError(
            "AI generation is unavailable — the Claude API returned an unusable response. Nothing was generated or saved."
        )
