import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.clients.models import Client
    from app.modules.design_briefs.models import DesignBrief
    from app.modules.leads.models import Lead
    from app.modules.meetings.models import Meeting
    from app.modules.tasks.models import Task
    from app.modules.users.models import User
    from app.modules.websites.models import Website


class ProjectStage(str, enum.Enum):
    """
    The delivery-side pipeline a project moves through, from signed
    client to closed-out engagement. Replaces the earlier stage set
    (see docs/05_DECISIONS.md for the migration/mapping) per explicit
    operator-specified stages for the lead-to-client conversion
    workflow.
    """

    INTAKE = "intake"
    RESEARCH = "research"
    BRIEF = "brief"
    DESIGN = "design"
    DEVELOPMENT = "development"
    QA = "qa"
    CLIENT_REVIEW = "client_review"
    REVISIONS = "revisions"
    READY_TO_DEPLOY = "ready_to_deploy"
    DEPLOYED = "deployed"
    MAINTENANCE = "maintenance"
    COMPLETE = "complete"


class Project(Base):
    """The delivery-side unit of work for a client."""

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    # Set when this project was created by converting a won lead — the
    # direct traceability pointer back to that lead (see
    # docs/05_DECISIONS.md). Null for projects added independently of a
    # conversion (e.g. a second project for an existing client).
    source_lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(255))
    stage: Mapped[ProjectStage] = mapped_column(
        Enum(ProjectStage, name="project_stage"), default=ProjectStage.INTAKE
    )
    # The agreed terms of this project's engagement — captured once
    # (typically at lead conversion) and owned by the project from then
    # on, not re-derived from the sales side on every read.
    package: Mapped[str | None] = mapped_column(String(50))
    price_cents: Mapped[int | None] = mapped_column(Integer)
    deadline: Mapped[date | None] = mapped_column(Date)
    # Free-text build direction the operator brings in from outside the app
    # (a ChatGPT/Claude session working through concept, visual direction,
    # copy, page structure, generation prompts, ...). Optional — a project
    # is fully usable without it. Fed into the sitemap / creative-direction
    # generation steps as extra context when present.
    build_direction: Mapped[str | None] = mapped_column(Text)
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Set only by modules/projects/service.py::mark_delivered, the final
    # step of the delivery workflow (docs/04_ROADMAP.md M6) — gated on a
    # verified live deployment plus a completed final delivery checklist
    # (see DEFAULT_LAUNCH_TASK_TITLES in service.py). Never set any other
    # way, including the free-form ProjectUpdate/stage change below.
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    client: Mapped["Client"] = relationship(back_populates="projects")
    source_lead: Mapped["Lead | None"] = relationship()
    assigned_user: Mapped["User | None"] = relationship(foreign_keys=[assigned_user_id])
    delivered_by_user: Mapped["User | None"] = relationship(foreign_keys=[delivered_by_user_id])
    tasks: Mapped[list["Task"]] = relationship(back_populates="project")
    meetings: Mapped[list["Meeting"]] = relationship(back_populates="project")
    design_briefs: Mapped["DesignBrief | None"] = relationship(back_populates="project", uselist=False)
    websites: Mapped[list["Website"]] = relationship(back_populates="project")
