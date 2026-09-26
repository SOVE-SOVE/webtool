import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ReferenceCaptureStatus(str, enum.Enum):
    PENDING = "pending"
    CAPTURED = "captured"
    FAILED = "failed"


class WebsiteReference(Base):
    """
    A website saved to the workspace's shared Reference Library — how a
    site LOOKS and FEELS, as inspiration, never a feature requirement and
    never permission to copy its text, branding, imagery or code. One row
    per normalised URL per workspace (`normalized_url` + the unique
    constraint). The preview is captured once by a background job and
    stored here (same base64-in-DB convention as WebsiteAudit); browsing
    serves the stored image and never refetches the site. `notes` are the
    shared, general notes; plan-specific direction lives on
    LeadPlanningReference. Archiving hides it from the library but keeps
    every plan that uses it intact.
    """

    __tablename__ = "website_references"
    __table_args__ = (UniqueConstraint("workspace_id", "normalized_url", name="uq_website_reference_workspace_url"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(2048))
    normalized_url: Mapped[str] = mapped_column(String(2048))
    name: Mapped[str] = mapped_column(String(200))
    tags: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    capture_status: Mapped[ReferenceCaptureStatus] = mapped_column(
        Enum(ReferenceCaptureStatus, name="reference_capture_status"), default=ReferenceCaptureStatus.PENDING
    )
    capture_error: Mapped[str | None] = mapped_column(Text)
    screenshot_base64: Mapped[str | None] = mapped_column(Text, deferred=True)
    screenshot_captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    attachments: Mapped[list["LeadPlanningReference"]] = relationship(back_populates="reference")


class LeadPlanningReference(Base):
    """A shared WebsiteReference attached to one plan, with that plan's own
    direction ("use the spacious layout, not the colours") and the aspects
    the operator likes. These are the operator's observations of a static
    preview plus the live site — never verified findings. Removing the
    attachment never touches the shared reference; the FK is RESTRICT so a
    reference in use can't be hard-deleted out from under a plan."""

    __tablename__ = "lead_planning_references"
    __table_args__ = (UniqueConstraint("lead_planning_id", "reference_id", name="uq_lead_planning_reference"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_planning_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lead_planning.id", ondelete="CASCADE"), index=True)
    reference_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("website_references.id", ondelete="RESTRICT"), index=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    direction: Mapped[str | None] = mapped_column(Text)
    liked_aspects: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    reference: Mapped[WebsiteReference] = relationship(back_populates="attachments", lazy="joined")
