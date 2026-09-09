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
        images_base64: list[str] | None = None,
    ) -> dict:
        """
        `images_base64`, when given, attaches each image (PNG) to the
        user message ahead of the text — used by
        agents/planning_visual_review.py so the model's findings are
        grounded in what's actually visible in the screenshot. Anthropic-
        specific: not part of the shared AIProvider Protocol (base.py),
        since the router's other provider (Ollama) has no vision path
        and none of the task-routed call sites need one.
        """
        if not settings.llm_api_key:
            raise AIProviderError(
                "AI generation is unavailable — no Claude API key is configured (set LLM_API_KEY). "
                "Nothing was generated or saved."
            )

        content: str | list[dict] = user
        if images_base64:
            content = [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img}}
                for img in images_base64
            ] + [{"type": "text", "text": user}]

        client = anthropic.Anthropic(api_key=settings.llm_api_key)
        try:
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
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
