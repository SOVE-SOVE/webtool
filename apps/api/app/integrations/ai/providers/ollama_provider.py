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

from app.integrations.ai.errors import AIProviderModelMissingError, AIProviderUnavailableError
from app.integrations.ai.providers.base import GenerationResult


def _looks_like_missing_model(response: httpx.Response) -> bool:
    """Ollama answers a request for a model it hasn't pulled with a 404
    (sometimes 400) whose body mentions the model isn't found / needs
    pulling. Distinguishing this from 'server down' lets the operator get
    'run `ollama pull X`' instead of 'is Ollama running'."""
    if response.status_code not in (400, 404):
        return False
    body = response.text.lower()
    return "not found" in body or "try pulling" in body or "no such model" in body


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
    ) -> GenerationResult:
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
        except httpx.TimeoutException as exc:
            raise AIProviderUnavailableError(
                f"Local AI timed out after {self._timeout_seconds}s. Ollama at {self._base_url} "
                f"is running but didn't respond in time — the machine may be under load, or "
                f"{model!r} may be too large for it. Nothing was generated or saved."
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderUnavailableError(
                f"Local AI is unavailable. Make sure Ollama is running at {self._base_url} "
                f"and the model {model!r} is installed (`ollama pull {model}`). "
                f"Nothing was generated or saved. ({type(exc).__name__})"
            ) from exc

        if _looks_like_missing_model(response):
            raise AIProviderModelMissingError(
                f"Local AI model {model!r} is not installed on the Ollama server at "
                f"{self._base_url}. Install it with: ollama pull {model}. "
                f"Nothing was generated or saved."
            )
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise AIProviderUnavailableError(
                f"Local AI is unavailable — Ollama at {self._base_url} returned "
                f"{response.status_code}. Nothing was generated or saved. ({type(exc).__name__})"
            ) from exc

        try:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            usage = data.get("usage") or {}
            return GenerationResult(
                data=parsed,
                input_tokens=usage.get("prompt_tokens"),
                output_tokens=usage.get("completion_tokens"),
            )
        except (KeyError, IndexError, ValueError) as exc:
            raise AIProviderUnavailableError(
                f"Local AI is unavailable — Ollama at {self._base_url} returned a response "
                f"that couldn't be used ({type(exc).__name__}). The model {model!r} may not "
                f"support JSON-schema-constrained output. Nothing was generated or saved."
            ) from exc
