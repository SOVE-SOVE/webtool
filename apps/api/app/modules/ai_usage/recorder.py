"""
Writes one AiUsageEvent row per AI task execution. Called by
app/integrations/ai/router.py (via a deferred import so this module,
which imports the DB layer, doesn't create an import cycle).

Hard rule: recording usage must NEVER break or slow the generation it
describes. Every path here is wrapped so a DB hiccup, a mapping error,
or a bad value is logged and swallowed — the caller is unaffected.
"""

from app.core.logging import logger
from app.modules.ai_usage.pricing import estimate_cost_usd


def record_ai_usage(
    *,
    task: str,
    provider: str,
    model: str,
    success: bool,
    duration_ms: int,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    retries: int = 0,
    error_category: str | None = None,
) -> None:
    # Cost is only meaningful for a call that actually produced output.
    cost_usd = None
    if success:
        try:
            cost_usd = estimate_cost_usd(provider, model, input_tokens, output_tokens)
        except Exception:  # noqa: BLE001 — pricing math must never raise into the caller
            logger.exception("ai_usage: cost estimation failed for task=%s model=%s", task, model)

    # One structured log line regardless of whether the DB write below
    # succeeds — gives cost/debug visibility even without querying the table.
    # Deliberately contains no prompt, response, or business content.
    logger.info(
        "ai_usage task=%s provider=%s model=%s success=%s duration_ms=%s "
        "input_tokens=%s output_tokens=%s retries=%s error_category=%s cost_usd=%s",
        task, provider, model, success, duration_ms,
        input_tokens, output_tokens, retries, error_category, cost_usd,
    )

    try:
        from app.db.session import SessionLocal
        from app.modules.ai_usage.models import AiUsageEvent

        db = SessionLocal()
        try:
            db.add(
                AiUsageEvent(
                    task=task,
                    provider=provider,
                    model=model,
                    success=success,
                    duration_ms=duration_ms,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    retries=retries,
                    error_category=error_category,
                    cost_usd=cost_usd,
                )
            )
            db.commit()
        finally:
            db.close()
    except Exception:  # noqa: BLE001 — observability must not break generation
        logger.exception("ai_usage: failed to persist usage event for task=%s", task)
