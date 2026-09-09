"""
Ollama provider — implements AIProvider (base.py) against a self-hosted
Ollama server's OpenAI-compatible /v1/chat/completions endpoint, using
JSON-schema-constrained output for structured results (the same
approach as scripts/ai_benchmark/run_benchmark.py, which validated this
integration style — see the T2 report).

Not called by any existing feature yet (see T1/T3 — no agent has been
migrated to the router). Failure here (connection refused, timed out,
malformed/schema-invalid response) is NEVER silently retried against
Anthropic by this class — that would defeat the entire cost-control
purpose of local routing. See app/integrations/ai/router.py for the one
explicit, opt-in fallback knob (settings.ai_local_fallback_to_premium,
default off).
"""

import json

import httpx

from app.integrations.ai.errors import AIProviderUnavailableError


class OllamaProvider:
    def __init__(self, base_url: str, timeout_seconds: float = 120.0):
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    def generate_structured(
        self,
        system: str,
        user: str,
        schema: dict,
        model: str,
        max_tokens: int = 4096,
    ) -> dict:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "emit_result", "schema": schema, "strict": True},
            },
        }
        try:
            response = httpx.post(
                f"{self._base_url}/v1/chat/completions",
                json=payload,
                timeout=self._timeout_seconds,
            )
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise AIProviderUnavailableError(
                f"AI generation is unavailable — the local AI server at {self._base_url} timed out "
                f"after {self._timeout_seconds}s. Nothing was generated or saved."
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderUnavailableError(
                f"AI generation is unavailable — couldn't reach the local AI server at "
                f"{self._base_url} ({exc}). Nothing was generated or saved."
            ) from exc

        try:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            return json.loads(content)
        except (KeyError, IndexError, ValueError) as exc:
            raise AIProviderUnavailableError(
                f"AI generation is unavailable — the local AI server at {self._base_url} returned "
                f"an unusable response ({type(exc).__name__}). Nothing was generated or saved."
            ) from exc
