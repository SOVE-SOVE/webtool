"""
Logic shared identically by both checklist systems — `checklists/`
(Client Setup & Delivery) and `stage_checklists/` (Discovery review/Lead/
Planning/Project). Kept in one place so "required vs optional progress",
"what's the next action", and "has a reviewed task gone stale" behave the
same way everywhere rather than the two systems slowly diverging
(docs/05_DECISIONS.md — two tables, one set of rules).
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

ACTIONABLE_STATUSES = {"pending", "needs_review"}


@dataclass
class ProgressPart:
    completed: int
    total: int
    pct: int | None  # None when total == 0


@dataclass
class ProgressSplit:
    required: ProgressPart
    optional: ProgressPart


def _progress_part(statuses: list[str]) -> ProgressPart:
    total = len(statuses)
    completed = sum(1 for s in statuses if s == "complete")
    pct = round(completed / total * 100) if total > 0 else None
    return ProgressPart(completed=completed, total=total, pct=pct)


def compute_progress_split(rows: list[tuple[str, bool]]) -> ProgressSplit:
    """`rows`: (effective_status, is_required) pairs. `not_required` is
    excluded from both buckets entirely, unchanged from the original
    single-bucket rule; every other status (pending/blocked/needs_review/
    complete) counts toward its bucket's total, only "complete" toward
    completed."""
    required = [s for s, is_required in rows if is_required and s != "not_required"]
    optional = [s for s, is_required in rows if not is_required and s != "not_required"]
    return ProgressSplit(required=_progress_part(required), optional=_progress_part(optional))


@dataclass
class NextActionCandidate:
    id: Any
    title: str
    status: str
    is_required: bool
    order_index: int
    link: Any | None
    assigned_user_name: str | None
    blocked_reason: str | None


@dataclass
class NextAction:
    kind: str  # "task" | "blocked" | "done"
    item: NextActionCandidate | None = None
    items: list[NextActionCandidate] | None = None


def select_next_action(candidates: list[NextActionCandidate]) -> NextAction:
    """Priority: the first actionable (pending/needs_review) REQUIRED
    task in checklist order. If none are actionable because every
    remaining required task is BLOCKED, surface all of their blocking
    reasons instead of guessing at an unavailable action. Only once no
    required task is actionable or blocked does an optional task get
    surfaced. Nothing left at all -> "done"."""
    ordered = sorted(candidates, key=lambda c: c.order_index)
    applicable = [c for c in ordered if c.status != "not_required"]
    required = [c for c in applicable if c.is_required]
    optional = [c for c in applicable if not c.is_required]

    required_actionable = [c for c in required if c.status in ACTIONABLE_STATUSES]
    if required_actionable:
        return NextAction(kind="task", item=required_actionable[0])

    required_blocked = [c for c in required if c.status == "blocked"]
    if required_blocked:
        return NextAction(kind="blocked", items=required_blocked)

    optional_actionable = [c for c in optional if c.status in ACTIONABLE_STATUSES]
    if optional_actionable:
        return NextAction(kind="task", item=optional_actionable[0])

    return NextAction(kind="done")


@dataclass
class ManualReviewResult:
    effective_status: str
    needs_review_reason: str | None


def resolve_manual_review_status(
    stored_status: str,
    item_completed_at: datetime | None,
    live_completed_at: datetime | None,
    signal_label: str,
) -> ManualReviewResult:
    """A MANUAL item with an auto_signal that's stored COMPLETE flips to
    a read-time-only "needs_review" once the signal's own source has
    changed more recently than the item's own completed_at — never
    stored, recomputed fresh on every read (same discipline an AUTOMATIC
    item's live status already uses)."""
    if (
        stored_status == "complete"
        and item_completed_at is not None
        and live_completed_at is not None
        and live_completed_at > item_completed_at
    ):
        return ManualReviewResult(
            effective_status="needs_review",
            needs_review_reason=f"{signal_label} changed after this was marked complete.",
        )
    return ManualReviewResult(effective_status=stored_status, needs_review_reason=None)
