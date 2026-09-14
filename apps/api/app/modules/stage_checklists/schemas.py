import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.modules.checklists.schemas import ChecklistCompletedBy, ChecklistLink

StageChecklistCompletionModeLiteral = Literal["automatic", "manual"]
# "needs_review" only ever appears in a response — never stored (see
# stage_checklists/models.py's StageChecklistItem docstring).
StageChecklistItemStatusLiteral = Literal["pending", "complete", "not_required", "blocked", "needs_review"]
# A status an operator can actually set via PATCH.
StageChecklistItemSettableStatusLiteral = Literal["pending", "complete", "not_required", "blocked"]


class StageChecklistItemRead(BaseModel):
    id: uuid.UUID
    title: str
    order_index: int
    is_default: bool
    is_required: bool
    completion_mode: StageChecklistCompletionModeLiteral
    status: StageChecklistItemStatusLiteral
    completed_at: datetime | None
    completed_by: ChecklistCompletedBy | None
    link: ChecklistLink | None
    assigned_user_id: uuid.UUID | None
    assigned_user_name: str | None
    blocked_reason: str | None
    needs_review_reason: str | None = None
    created_at: datetime
    updated_at: datetime


class StageChecklistProgressPart(BaseModel):
    completed: int
    total: int
    pct: int | None  # None when total == 0 (empty, or every item Not Required)


class StageChecklistProgress(BaseModel):
    """Required and optional tasks tracked separately — see
    checklists/schemas.py::ChecklistProgress, same shape."""

    required: StageChecklistProgressPart
    optional: StageChecklistProgressPart


class StageChecklistNextAction(BaseModel):
    """See checklists/schemas.py::ChecklistNextAction — identical shape,
    kept as a separate type only because it wraps StageChecklistItemRead."""

    kind: Literal["task", "blocked", "done"]
    item: StageChecklistItemRead | None = None
    items: list[StageChecklistItemRead] | None = None


class StageChecklistRead(BaseModel):
    items: list[StageChecklistItemRead]
    progress: StageChecklistProgress
    next_item: StageChecklistItemRead | None
    next_action: StageChecklistNextAction


class AddStageChecklistItemRequest(BaseModel):
    title: str
    assigned_user_id: uuid.UUID | None = None


class UpdateStageChecklistItemRequest(BaseModel):
    title: str | None = None
    status: StageChecklistItemSettableStatusLiteral | None = None
    assigned_user_id: uuid.UUID | None = None
    blocked_reason: str | None = None
    note: str | None = None


class StageChecklistItemOrderItem(BaseModel):
    id: uuid.UUID
    order_index: int


class ReorderStageChecklistItemsRequest(BaseModel):
    items: list[StageChecklistItemOrderItem]
