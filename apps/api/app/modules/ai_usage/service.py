"""
Read side of the AI usage log. Aggregates exist to answer five
operator questions and nothing more (see docs/02_ARCHITECTURE.md §6):

  - What model handled a given task?          -> by_task (task, provider, model)
  - How much Anthropic usage are we running?  -> by_provider["anthropic"], known_cost_usd
  - How many tasks moved to Ollama?           -> by_provider["ollama"], local_events
  - Which tasks are still expensive?          -> by_task, cost-ordered
  - Which AI calls are failing?               -> recent_failures, per-rollup `failures`
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.modules.ai_usage.models import AiUsageEvent
from app.modules.ai_usage.schemas import (
    AiUsageEventRead,
    AiUsageSummary,
    ProviderRollup,
    TaskRollup,
)

_MAX_EVENTS_PAGE = 200
_RECENT_FAILURES = 20


def _to_read(row: AiUsageEvent) -> AiUsageEventRead:
    return AiUsageEventRead(
        id=str(row.id),
        created_at=row.created_at,
        task=row.task,
        provider=row.provider,
        model=row.model,
        success=row.success,
        duration_ms=row.duration_ms,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        retries=row.retries,
        error_category=row.error_category,
        cost_usd=row.cost_usd,
    )


def list_events(
    db: Session,
    *,
    limit: int = 50,
    task: str | None = None,
    provider: str | None = None,
    success: bool | None = None,
) -> list[AiUsageEventRead]:
    stmt = select(AiUsageEvent).order_by(AiUsageEvent.created_at.desc())
    if task is not None:
        stmt = stmt.where(AiUsageEvent.task == task)
    if provider is not None:
        stmt = stmt.where(AiUsageEvent.provider == provider)
    if success is not None:
        stmt = stmt.where(AiUsageEvent.success.is_(success))
    stmt = stmt.limit(max(1, min(limit, _MAX_EVENTS_PAGE)))
    return [_to_read(r) for r in db.scalars(stmt)]


def summary(db: Session, *, since_days: int = 30) -> AiUsageSummary:
    since = datetime.now(timezone.utc) - timedelta(days=max(1, since_days))
    in_window = AiUsageEvent.created_at >= since

    fail_sum = func.coalesce(func.sum(case((AiUsageEvent.success.is_(False), 1), else_=0)), 0)
    tok_in = func.coalesce(func.sum(AiUsageEvent.input_tokens), 0)
    tok_out = func.coalesce(func.sum(AiUsageEvent.output_tokens), 0)
    cost = func.sum(AiUsageEvent.cost_usd)  # NULLs skipped by SUM

    provider_rows = db.execute(
        select(
            AiUsageEvent.provider,
            func.count(),
            fail_sum,
            tok_in,
            tok_out,
            cost,
        )
        .where(in_window)
        .group_by(AiUsageEvent.provider)
        .order_by(func.count().desc())
    ).all()

    by_provider = [
        ProviderRollup(
            provider=p,
            events=events,
            failures=int(failures),
            input_tokens=int(ti),
            output_tokens=int(to),
            cost_usd=(round(float(c), 6) if c is not None else None),
        )
        for (p, events, failures, ti, to, c) in provider_rows
    ]

    task_rows = db.execute(
        select(
            AiUsageEvent.task,
            AiUsageEvent.provider,
            AiUsageEvent.model,
            func.count(),
            fail_sum,
            func.coalesce(func.avg(AiUsageEvent.duration_ms), 0),
            tok_in,
            tok_out,
            cost,
        )
        .where(in_window)
        .group_by(AiUsageEvent.task, AiUsageEvent.provider, AiUsageEvent.model)
    ).all()

    by_task = sorted(
        (
            TaskRollup(
                task=t,
                provider=p,
                model=m,
                events=events,
                failures=int(failures),
                avg_duration_ms=int(avg_ms),
                input_tokens=int(ti),
                output_tokens=int(to),
                cost_usd=(round(float(c), 6) if c is not None else None),
            )
            for (t, p, m, events, failures, avg_ms, ti, to, c) in task_rows
        ),
        key=lambda r: (r.cost_usd or 0.0, r.events),
        reverse=True,
    )

    recent_failures = [
        _to_read(r)
        for r in db.scalars(
            select(AiUsageEvent)
            .where(in_window, AiUsageEvent.success.is_(False))
            .order_by(AiUsageEvent.created_at.desc())
            .limit(_RECENT_FAILURES)
        )
    ]

    total_events = sum(r.events for r in by_provider)
    total_failures = sum(r.failures for r in by_provider)
    known_cost = round(sum(r.cost_usd for r in by_provider if r.cost_usd is not None), 6)

    return AiUsageSummary(
        since=since,
        generated_at=datetime.now(timezone.utc),
        total_events=total_events,
        total_failures=total_failures,
        known_cost_usd=known_cost,
        anthropic_events=sum(r.events for r in by_provider if r.provider == "anthropic"),
        local_events=sum(r.events for r in by_provider if r.provider not in ("anthropic",)),
        by_provider=by_provider,
        by_task=by_task,
        recent_failures=recent_failures,
    )
