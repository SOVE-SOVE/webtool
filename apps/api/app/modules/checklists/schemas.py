import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

ChecklistCompletionModeLiteral = Literal["automatic", "manual"]
# Response status — includes the two read-time-only computed values.
ChecklistItemStatusLiteral = Literal["pending", "complete", "not_required", "blocked", "needs_review"]
# A status an operator can actually set via PATCH — "needs_review" is
# never directly settable, only ever computed on read.
ChecklistItemSettableStatusLiteral = Literal["pending", "complete", "not_required", "blocked"]


class ChecklistLink(BaseModel):
    """Where an automatic item's linked signal can be reviewed —
    computed server-side per auto_signal, never hardcoded per-row on
    the frontend."""

    label: str
    href: str


class ChecklistCompletedBy(BaseModel):
    type: Literal["user", "system"]
    name: str | None = None
    via: str | None = None


class ChecklistItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    client_id: uuid.UUID
    project_id: uuid.UUID | None
    title: str
    order_index: int
    is_default: bool
    is_required: bool
    completion_mode: ChecklistCompletionModeLiteral
    status: ChecklistItemStatusLiteral
    completed_at: datetime | None
    completed_by: ChecklistCompletedBy | None
    link: ChecklistLink | None
    assigned_user_id: uuid.UUID | None
    assigned_user_name: str | None
    blocked_reason: str | None
    needs_review_reason: str | None = None
    created_at: datetime
    updated_at: datetime


class ChecklistProgressPart(BaseModel):
    completed: int
    total: int
    pct: int | None  # None when total == 0 (empty, or every item Not Required)


class ChecklistProgress(BaseModel):
    """Required and optional tasks are tracked separately — a business
    can be "ready" (required: 5 of 5) while optional improvements remain
    open, and the two must never blend into one misleading percentage."""

    required: ChecklistProgressPart
    optional: ChecklistProgressPart


class ChecklistNextAction(BaseModel):
    """A compact "what to do next" summary, prioritising actionable
    required tasks in checklist order. `kind`:
    - "task": `item` is the next actionable task to work on.
    - "blocked": every remaining required task is blocked — `items`
      lists each one so its reason is visible, rather than pretending
      there's an available next step.
    - "done": nothing actionable or blocked remains."""

    kind: Literal["task", "blocked", "done"]
    item: ChecklistItemRead | None = None
    items: list[ChecklistItemRead] | None = None


class ClientChecklistProjectSection(BaseModel):
    project_id: uuid.UUID
    project_name: str
    items: list[ChecklistItemRead]
    progress: ChecklistProgress
    next_item: ChecklistItemRead | None
    next_action: ChecklistNextAction


class ClientChecklistRead(BaseModel):
    client_id: uuid.UUID
    client_items: list[ChecklistItemRead]
    client_progress: ChecklistProgress
    client_next_action: ChecklistNextAction
    projects: list[ClientChecklistProjectSection]


class AddChecklistItemRequest(BaseModel):
    title: str
    project_id: uuid.UUID | None = None
    assigned_user_id: uuid.UUID | None = None


class UpdateChecklistItemRequest(BaseModel):
    title: str | None = None
    status: ChecklistItemSettableStatusLiteral | None = None
    # Present-but-null unassigns; omitted leaves assignment untouched —
    # same convention as ProjectUpdate/TaskUpdate's assigned_user_id.
    assigned_user_id: uuid.UUID | None = None
    # Required (non-empty) when setting status="blocked"; ignored
    # otherwise unless the item is already blocked, in which case it
    # edits the reason text in place without a status transition.
    blocked_reason: str | None = None
    # Optional free-text note folded into the activity-log entry for
    # this update — never required, never blocks a plain tick.
    note: str | None = None


class ChecklistItemOrderItem(BaseModel):
    id: uuid.UUID
    order_index: int


class ReorderChecklistItemsRequest(BaseModel):
    items: list[ChecklistItemOrderItem]


class ClientChecklistSummary(BaseModel):
    client_id: uuid.UUID
    completed: int
    total: int
    pct: int | None
