"""
AI cost estimation — the ONE place that turns token counts into a
dollar figure. Pricing itself is configuration
(settings.ai_anthropic_pricing_usd_per_mtok), never hard-coded here.
"""

from app.core.settings import settings

# Providers that never incur a per-token API charge — recorded as $0,
# not as an unknown and not as a fake token cost.
_NO_API_COST_PROVIDERS = {"ollama"}


def estimate_cost_usd(
    provider: str,
    model: str,
    input_tokens: int | None,
    output_tokens: int | None,
) -> float | None:
    """
    Returns the USD estimate for one generation, or None when it can't
    be known:
      - local/self-hosted provider  -> 0.0 (no API charge)
      - priced Anthropic model      -> computed from configured $/Mtok
      - unpriced model / missing tokens -> None (unknown, never guessed)
    """
    if provider in _NO_API_COST_PROVIDERS:
        return 0.0

    prices = settings.ai_anthropic_pricing_usd_per_mtok.get(model)
    if not prices or input_tokens is None or output_tokens is None:
        return None

    per_mtok_in = prices.get("input")
    per_mtok_out = prices.get("output")
    if per_mtok_in is None or per_mtok_out is None:
        return None

    return round(
        (input_tokens / 1_000_000) * per_mtok_in + (output_tokens / 1_000_000) * per_mtok_out,
        6,
    )
