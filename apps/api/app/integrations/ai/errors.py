"""
Error hierarchy for the AI provider/task-routing system. AIProviderError
subclasses the existing LlmUnavailableError so app/main.py's existing
`@app.exception_handler(LlmUnavailableError)` already covers routed AI
calls too, once a feature migrates to app.integrations.ai.router — no
change to main.py needed for that.
"""

from app.integrations.errors import LlmUnavailableError


class AIProviderError(LlmUnavailableError):
    """Base for any AI-provider-level failure raised by app/integrations/ai/."""


class AIProviderUnavailableError(AIProviderError):
    """
    The routed provider could not be reached at all (connection refused,
    timed out) or returned a response that couldn't be used (bad JSON,
    didn't match the requested schema). Never caught-and-retried against
    a different provider automatically — see router.py's one explicit,
    opt-in fallback knob.
    """


class AIProviderModelMissingError(AIProviderUnavailableError):
    """
    The local (Ollama) server is reachable but the configured model has
    not been pulled. Distinct from a plain "unavailable" so the operator
    is told to run `ollama pull <model>` rather than "check the server" —
    the application never downloads models itself.
    """
