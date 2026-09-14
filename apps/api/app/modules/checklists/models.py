import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, func, true
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.clients.models import Client
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class ChecklistCompletionMode(str, enum.Enum):
    """AUTOMATIC items are never toggled directly — their effective
    status is always recomputed from a live signal (see
    checklists/signals.py) except for an explicit NOT_REQUIRED override.
    MANUAL items have no reliable authoritative signal, so `status` is
    the sole source of truth for them."""

    AUTOMATIC = "automatic"
    MANUAL = "manual"


class ChecklistItemStatus(str, enum.Enum):
    """For a MANUAL item this is authoritative. For an AUTOMATIC item
    this column only ever holds NOT_REQUIRED/BLOCKED (an operator
    override) or stays null — COMPLETE is never stored for an automatic
    item, it's computed fresh on every read from its linked signal.
    NOT_REQUIRED and BLOCKED share the same override precedence: either
    one wins over a live AUTOMATIC signal (see checklists/shared.py).
    "needs_review" (checklists/schemas.py) is never stored — it's a
    read-time-only effective status for a MANUAL item whose linked
    signal changed after it was marked complete."""

    PENDING = "pending"
    COMPLETE = "complete"
    NOT_REQUIRED = "not_required"
    BLOCKED = "blocked"


class ChecklistAutoSignal(str, enum.Enum):
    """Which existing authoritative record an AUTOMATIC item's effective
    status is read from — see checklists/signals.py::resolve_all for the
    exact query behind each one."""

    WEBSITE_SCOPE_CONFIRMED = "website_scope_confirmed"
    DIRECTION_APPROVED = "direction_approved"
    CONTENT_APPROVED = "content_approved"
    PREVIEW_BUILT = "preview_built"
    QA_COMPLETE = "qa_complete"
    LAUNCH_APPROVED = "launch_approved"
    WEBSITE_LAUNCHED = "website_launched"


class ClientChecklistItem(Base):
    """
    One task in a client's "Client Setup & Delivery" checklist.
    `project_id IS NULL` marks a client-level task (business/contact
    setup, shared across however many projects this client has);
    `project_id` set scopes a task to that one project's delivery work,
    so two projects never share rows and completing one can never flip
    the other's tasks (docs/05_DECISIONS.md).

    Deliberately not the generic `Task` model (app/modules/tasks/models.py)
    — that one has no client_id, no tri-state "not required", and no
    automatic/manual distinction, and is already relied on elsewhere
    (project intake/launch checklists) in a shape that would be risky
    to overload.
    """

    __tablename__ = "client_checklist_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_default: Mapped[bool] = mapped_column(default=False)
    completion_mode: Mapped[ChecklistCompletionMode] = mapped_column(
        Enum(ChecklistCompletionMode, name="checklist_completion_mode"), default=ChecklistCompletionMode.MANUAL
    )
    auto_signal: Mapped[ChecklistAutoSignal | None] = mapped_column(
        Enum(ChecklistAutoSignal, name="checklist_auto_signal")
    )
    status: Mapped[ChecklistItemStatus | None] = mapped_column(Enum(ChecklistItemStatus, name="checklist_item_status"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Who's responsible for this task — separate from completed_by_user_id
    # (who actually ticked it). Unassigned by default; reassignment is a
    # plain workspace-membership-scoped set, same as Task/Project/Lead/
    # Client's own assigned_user_id (docs/05_DECISIONS.md).
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Set only while status == BLOCKED; cleared on unblock. The task's
    # own completion history (activity log) is untouched by block/unblock
    # — only this live field changes.
    blocked_reason: Mapped[str | None] = mapped_column(String(500))
    # Static per-task classification (not a per-instance override — that's
    # what NOT_REQUIRED already does). True for every default-seeded task;
    # custom/operator-added tasks default False (docs/05_DECISIONS.md).
    is_required: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    client: Mapped["Client"] = relationship()
    project: Mapped["Project | None"] = relationship()
    completed_by_user: Mapped["User | None"] = relationship(foreign_keys=[completed_by_user_id])
    assigned_user: Mapped["User | None"] = relationship(foreign_keys=[assigned_user_id])
