import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.users.models import User
    from app.modules.websites.models import Website


class Deployment(Base):
    """
    One row per deploy attempt for a website version — approval
    checkpoint 7 ("Final deployment", docs/05_DECISIONS.md's human-
    approval-workflow entry). Creating a row (`status="pending"`) IS the
    approval record (who/when/notes) for this checkpoint:
    modules/deployments/service.py refuses to create one at all unless
    every prior checkpoint (brief, creative direction, sitemap,
    generated website, QA, client review) is currently approved for
    this project, plus the extra pre-deploy checks in
    modules/deployments/checks.py — see modules/approvals/service.py.

    Execution is a separate, explicit step (`execute_deployment`,
    "pending" -> "running" -> "success"/"failed") through
    `integrations/deployment.py`'s provider abstraction — `target`
    records which provider ran it ("mock" today; no real hosting
    account is configured, so nothing here is a live, publicly
    reachable site). `rollback_of_deployment_id` links a rollback
    deployment back to the (already-successfully-deployed) version it
    re-publishes.
    """

    __tablename__ = "deployments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    website_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"))
    environment: Mapped[str] = mapped_column(String(20))  # "production" | "preview"
    target: Mapped[str] = mapped_column(String(50), default="mock")  # provider name, e.g. "mock"
    url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|running|success|failed
    result: Mapped[dict | None] = mapped_column(JSON)  # provider-returned detail on success
    error_message: Mapped[str | None] = mapped_column(Text)  # populated on failure

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # == completed_at on success

    rollback_of_deployment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("deployments.id", ondelete="SET NULL")
    )

    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    website: Mapped["Website"] = relationship(back_populates="deployments")
    approved_by_user: Mapped["User | None"] = relationship()
    rollback_of: Mapped["Deployment | None"] = relationship(remote_side=[id])
