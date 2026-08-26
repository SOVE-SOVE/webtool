import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.projects.models import ProjectStage

if TYPE_CHECKING:
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class PlanStageStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class ProjectStagePlan(Base):
    """
    One row per (project, pipeline stage) — the editable project-plan
    entry for that stage: who's responsible, when it's due, and whether
    it needs an explicit approval before the project can be considered
    past it. Seeded wholesale when a project's brief is approved (see
    project_plans/service.py::create_plan_for_project, called from
    design_briefs/service.py::approve_brief), then freely editable —
    same "starting point, not a fixed workflow" contract as
    projects/service.py's DEFAULT_INTAKE_TASK_TITLES.
    """

    __tablename__ = "project_stage_plans"
    __table_args__ = (UniqueConstraint("project_id", "stage", name="uq_project_stage_plan"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    stage: Mapped[ProjectStage] = mapped_column(Enum(ProjectStage, name="project_stage"))
    label: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer)
    # The default responsibility — who owns this stage. Defaults to the
    # project's own assignee at plan-creation time; independently
    # reassignable per stage from there.
    responsible_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    due_at: Mapped[date | None] = mapped_column(Date)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[PlanStageStatus] = mapped_column(
        Enum(PlanStageStatus, name="plan_stage_status"), default=PlanStageStatus.PENDING
    )
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship()
    responsible_user: Mapped["User | None"] = relationship(foreign_keys=[responsible_user_id])
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])
