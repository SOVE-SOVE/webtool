import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.projects.models import ProjectStage

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class Task(Base):
    """An operator/agent to-do item. Belongs to exactly one of project or lead."""

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "(project_id IS NOT NULL)::int + (lead_id IS NOT NULL)::int = 1",
            name="task_belongs_to_exactly_one_parent",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(255))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Which pipeline stage this task belongs to, for project tasks seeded
    # from the project plan (project_plans/service.py). Purely
    # descriptive grouping — null for hand-added tasks and every lead
    # task, same as before this column existed.
    stage: Mapped[ProjectStage | None] = mapped_column(Enum(ProjectStage, name="project_stage"))
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["Project | None"] = relationship(back_populates="tasks")
    lead: Mapped["Lead | None"] = relationship()
    assigned_user: Mapped["User | None"] = relationship()
