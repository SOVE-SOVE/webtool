"""
Shared base error for "AI generation could not happen at all" across
every provider (Anthropic, Ollama). Lives in its own module (rather than
in integrations/llm.py or integrations/ai/errors.py) so both can import
it without a circular import: llm.py depends on the ai/ package
(AnthropicProvider), and ai/errors.py needs this class too.
"""


class LlmUnavailableError(RuntimeError):
    """
    The generation could not happen at all — no API key configured, no
    credit/quota left, the provider refused or was unreachable, or it
    answered with something unusable. Distinct from an ordinary bug so
    app/main.py can turn it into a 503 the operator can act on instead
    of an opaque "Internal server error": the honest answer is "this
    couldn't be generated, here's why", never a fabricated result.
    """
