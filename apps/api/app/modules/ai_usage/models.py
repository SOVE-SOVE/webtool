import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AiUsageEvent(Base):
    """
    One row per AI task execution, written by app/integrations/ai/router.py
    around every `generate_structured` call (T6). Lightweight cost/debug
    observability — NOT an analytics warehouse: no prompts, no responses,
    no business content, no API keys are ever stored here (only counts,
    timings, and the routing decision). Best-effort: a failure to write
    this row must never fail or slow the generation it describes.

    `cost_usd`: 0.0 for local (Ollama) inference — real "no API charge",
    not a synthetic token price. For Anthropic, the estimate from
    settings.ai_anthropic_pricing_usd_per_mtok when the model is priced
    there, else NULL (unknown — never guessed). See app/modules/ai_usage/
    pricing.py.
    """

    __tablename__ = "ai_usage_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    # Routing decision (app/integrations/ai/tasks.py + router.py).
    task: Mapped[str] = mapped_column(String(50), index=True)  # AITask value
    provider: Mapped[str] = mapped_column(String(20), index=True)  # "ollama" | "anthropic"
    model: Mapped[str] = mapped_column(String(100))

    success: Mapped[bool] = mapped_column(Boolean, index=True)
    duration_ms: Mapped[int] = mapped_column(Integer)
    # Provider-reported token counts — NULL when the provider didn't
    # report them (never estimated).
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    # Provider attempts beyond the first (the local->premium fallback is
    # the only path that retries today, so this is 0 or 1).
    retries: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Coarse bucket, only set when success is False. See router._error_category.
    error_category: Mapped[str | None] = mapped_column(String(40))
    # USD estimate; see class docstring. NULL = unknown pricing.
    cost_usd: Mapped[float | None] = mapped_column(Float)
