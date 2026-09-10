from datetime import datetime

from pydantic import BaseModel


class AiUsageEventRead(BaseModel):
    id: str
    created_at: datetime
    task: str
    provider: str
    model: str
    success: bool
    duration_ms: int
    input_tokens: int | None
    output_tokens: int | None
    retries: int
    error_category: str | None
    cost_usd: float | None


class ProviderRollup(BaseModel):
    provider: str
    events: int
    failures: int
    input_tokens: int
    output_tokens: int
    # None when no event in the window had known pricing (all unpriced /
    # missing token counts) — distinct from 0.0, which a local provider
    # legitimately reports.
    cost_usd: float | None


class TaskRollup(BaseModel):
    task: str
    provider: str
    model: str
    events: int
    failures: int
    avg_duration_ms: int
    input_tokens: int
    output_tokens: int
    cost_usd: float | None


class AiUsageSummary(BaseModel):
    since: datetime
    generated_at: datetime
    total_events: int
    total_failures: int
    # Sum of the known cost estimates in the window (unpriced events
    # contribute nothing rather than a guessed value).
    known_cost_usd: float
    anthropic_events: int
    local_events: int
    by_provider: list[ProviderRollup]
    # Ordered by known cost then event count — "which tasks are still expensive".
    by_task: list[TaskRollup]
    recent_failures: list[AiUsageEventRead]
