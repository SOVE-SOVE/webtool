import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.deployments.models import Deployment
    from app.modules.projects.models import Project
    from app.modules.qa_reports.models import QaReport


class WebsiteStatus(str, enum.Enum):
    DRAFT = "draft"
    LIVE = "live"


class Website(Base):
    """The generated site record for a project."""

    __tablename__ = "websites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    template_slug: Mapped[str | None] = mapped_column(String(120))
    config: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[WebsiteStatus] = mapped_column(Enum(WebsiteStatus, name="website_status"), default=WebsiteStatus.DRAFT)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship(back_populates="websites")
    qa_reports: Mapped[list["QaReport"]] = relationship(back_populates="website")
    deployments: Mapped[list["Deployment"]] = relationship(back_populates="website")
