import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.businesses.models import Business
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
    """
    The delivery-side unit of work — for a Client, or (before the
    operator explicitly converts) a speculative prospect Project owned
    directly by a Lead. Exactly one of `client_id`/`source_lead_id` is
    the *current* owner:
    - `client_id` set: a real, paying Client's project (today's
      original meaning). `source_lead_id` may ALSO be set here, purely
      as history — this is the same lead the project (and its Client)
      originated from.
    - `client_id` null: a prospect Project, owned by `source_lead_id`
      directly. No Client exists yet. Converting the Lead to a Client
      (clients/service.py::create_client) reassigns this same row
      (`client_id` set) rather than creating a second Project.

    `workspace_id` is denormalized directly onto Project (rather than
    reached via `client.business.workspace_id`) specifically so every
    workspace-scoped query across the app (briefs, sitemaps, websites,
    QA, deployments, tasks, dashboard counts, ...) keeps working
    identically for a prospect Project, which has no Client to join
    through.
    """

    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("client_id IS NOT NULL OR source_lead_id IS NOT NULL", name="project_has_an_owner"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    # The originating (or, for a prospect project, the *owning*) lead —
    # see the class docstring above. Null only for a project added
    # directly to an existing Client with no lead history at all.
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

    client: Mapped["Client | None"] = relationship(back_populates="projects")
    source_lead: Mapped["Lead | None"] = relationship()
    assigned_user: Mapped["User | None"] = relationship(foreign_keys=[assigned_user_id])
    delivered_by_user: Mapped["User | None"] = relationship(foreign_keys=[delivered_by_user_id])
    tasks: Mapped[list["Task"]] = relationship(back_populates="project")
    meetings: Mapped[list["Meeting"]] = relationship(back_populates="project")
    design_briefs: Mapped["DesignBrief | None"] = relationship(back_populates="project", uselist=False)
    websites: Mapped[list["Website"]] = relationship(back_populates="project")

    @property
    def owner_business(self) -> "Business":
        """The business behind whichever of Client/Lead currently owns
        this project — see the class docstring. Callers must have
        eager-loaded `client.business` or `source_lead.business` as
        appropriate; this never issues its own query."""
        return self.client.business if self.client is not None else self.source_lead.business
