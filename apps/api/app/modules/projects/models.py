import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.clients.models import Client
    from app.modules.design_briefs.models import DesignBrief
    from app.modules.tasks.models import Task
    from app.modules.users.models import User
    from app.modules.websites.models import Website


class ProjectStage(str, enum.Enum):
    """Mirrors the delivery half of the pipeline in docs/00_VISION.md."""

    INTAKE = "intake"
    PROJECT = "project"
    RESEARCH = "research"
    DESIGN_BRIEF = "design_brief"
    SITEMAP = "sitemap"
    COPY = "copy"
    WEBSITE = "website"
    QA = "qa"
    MY_APPROVAL = "my_approval"
    CLIENT_APPROVAL = "client_approval"
    DEPLOYMENT = "deployment"
    MAINTENANCE = "maintenance"


class Project(Base):
    """The delivery-side unit of work for a client."""

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    stage: Mapped[ProjectStage] = mapped_column(
        Enum(ProjectStage, name="project_stage"), default=ProjectStage.INTAKE
    )
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    client: Mapped["Client"] = relationship(back_populates="projects")
    assigned_user: Mapped["User | None"] = relationship()
    tasks: Mapped[list["Task"]] = relationship(back_populates="project")
    design_briefs: Mapped[list["DesignBrief"]] = relationship(back_populates="project")
    websites: Mapped[list["Website"]] = relationship(back_populates="project")
