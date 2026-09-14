import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, func, true
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.checklists.models import ChecklistCompletionMode, ChecklistItemStatus

if TYPE_CHECKING:
    from app.modules.discovery.models import DiscoveredBusiness
    from app.modules.leads.models import Lead
    from app.modules.planning.models import LeadPlanning
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class StageChecklistAutoSignal(str, enum.Enum):
    """Which existing timestamped record a stage-checklist item's live
    state is read from — see stage_checklists/signals.py. Used two ways
    depending on the row's completion_mode (reused from checklists.models):
    for an AUTOMATIC item the signal's `done` fully determines the
    effective status every read; for a MANUAL item it only drives a
    read-time 'needs_review' flip if the source has changed since the
    item was last marked complete — the stored status never records
    'needs_review' itself, only pending/complete/not_required."""

    DISCOVERY_SITE_REVIEW = "discovery_site_review"
    DISCOVERY_SCORE = "discovery_score"
    LEAD_RESEARCH = "lead_research"
    PLANNING_AUDIT = "planning_audit"
    PLANNING_REVIEW_INSIGHTS = "planning_review_insights"
    PLANNING_RECOMMENDATIONS = "planning_recommendations"
    PLANNING_STRUCTURE = "planning_structure"
    PLANNING_ASSETS = "planning_assets"
    PLANNING_BUILD_BRIEF_APPROVED = "planning_build_brief_approved"
    PROJECT_PREVIEW_BUILT = "project_preview_built"
    PROJECT_QA_COMPLETE = "project_qa_complete"
    PROJECT_LAUNCH_APPROVED = "project_launch_approved"


class StageChecklistItem(Base):
    """
    One task in a per-stage "Stage Checklist" panel — Discovery review,
    Lead, Planning, or Project, one of which owns any given row (exactly
    one of the four owner columns is set, enforced by the CHECK
    constraint below). Deliberately a separate table from
    `ClientChecklistItem` (checklists/models.py): that one requires a
    Client and is the already-shipped, tested "Client Setup & Delivery"
    checklist, untouched by this feature; every business spends real time
    in these four earlier stages before a Client (if ever) exists, so
    they need their own rows anchored to whichever record already exists
    at that point (docs/05_DECISIONS.md).

    Rows persist for the life of their owning record — importing a
    Discovery result to a Lead, converting a Lead to a Client, or
    transferring Planning to a Project never deletes the
    DiscoveredBusiness/Lead/LeadPlanning row itself, so each stage's
    checklist simply stays exactly where it was, still reachable from
    that record's own page.
    """

    __tablename__ = "stage_checklist_items"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(discovered_business_id, lead_id, lead_planning_id, project_id) = 1",
            name="ck_stage_checklist_item_exactly_one_owner",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    discovered_business_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("discovered_businesses.id", ondelete="CASCADE")
    )
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    lead_planning_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("lead_planning.id", ondelete="CASCADE"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))

    title: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_default: Mapped[bool] = mapped_column(default=False)
    completion_mode: Mapped[ChecklistCompletionMode] = mapped_column(
        Enum(ChecklistCompletionMode, name="checklist_completion_mode"), default=ChecklistCompletionMode.MANUAL
    )
    auto_signal: Mapped[StageChecklistAutoSignal | None] = mapped_column(
        Enum(StageChecklistAutoSignal, name="stage_checklist_auto_signal")
    )
    status: Mapped[ChecklistItemStatus | None] = mapped_column(Enum(ChecklistItemStatus, name="checklist_item_status"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Same three fields as ClientChecklistItem, same semantics — see that
    # model's docstring. Kept identical across both tables deliberately
    # (checklists/shared.py is the single place the shared behaviour
    # lives) rather than diverging (docs/05_DECISIONS.md).
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    blocked_reason: Mapped[str | None] = mapped_column(String(500))
    is_required: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    discovered_business: Mapped["DiscoveredBusiness | None"] = relationship()
    lead: Mapped["Lead | None"] = relationship()
    lead_planning: Mapped["LeadPlanning | None"] = relationship()
    project: Mapped["Project | None"] = relationship()
    completed_by_user: Mapped["User | None"] = relationship(foreign_keys=[completed_by_user_id])
    assigned_user: Mapped["User | None"] = relationship(foreign_keys=[assigned_user_id])
