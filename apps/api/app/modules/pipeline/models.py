import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.modules.leads.models import LeadStatus


class PipelineEvent(Base):
    """
    Stage-transition history for a lead or project. Deliberately not a
    generic polymorphic activity_log table — see docs/02_ARCHITECTURE.md §3.
    """

    __tablename__ = "pipeline_events"
    __table_args__ = (
        CheckConstraint(
            "(project_id IS NOT NULL)::int + (lead_id IS NOT NULL)::int = 1",
            name="pipeline_event_belongs_to_exactly_one_parent",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(50))  # e.g. "stage_changed"
    summary: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PipelineStageConfig(Base):
    """
    Per-workspace display config for a lead's sales-pipeline column: the
    board label and ordering for one `LeadStatus` value. Deliberately
    does NOT introduce a new set of stage keys — `LeadStatus` already
    *is* the pipeline (see docs/05_DECISIONS.md 2026-08-16, which
    explicitly rejected a second parallel "what state is this lead in"
    field). "Configurable" here means an operator can rename a column,
    reorder the board, and mark a status as a won/lost terminal column —
    not redefine what states a lead can actually be in, which would mean
    altering the `lead_status` Postgres enum and every status-transition
    code path that reasons about it.

    Rows are lazily seeded per workspace with sensible defaults (see
    `pipeline/service.py`'s `_DEFAULT_STAGES`) the first time a
    workspace's stages are read, rather than backfilled for every
    workspace in the migration.
    """

    __tablename__ = "pipeline_stage_configs"
    __table_args__ = (UniqueConstraint("workspace_id", "key", name="uq_pipeline_stage_workspace_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    key: Mapped[LeadStatus] = mapped_column(Enum(LeadStatus, name="lead_status"))
    label: Mapped[str] = mapped_column(String(60))
    sort_order: Mapped[int] = mapped_column(Integer)
    is_won: Mapped[bool] = mapped_column(Boolean, default=False)
    is_lost: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
