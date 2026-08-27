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
    `integrations/deployment/`'s provider abstraction — `target`
    records which provider ran it ("mock" by default; no real hosting
    account is configured for this app, so a "mock" row is never a
    live, publicly reachable site). `provider_ref` is the provider's own
    id for this deployment (e.g. a Vercel/Netlify deployment id),
    round-tripped into `get_status`/`rollback` for providers that
    support them — null for providers that don't return one.
    `rollback_of_deployment_id` links a rollback deployment back to the
    (already-successfully-deployed) version it re-publishes.

    `verified_at`/`verified_by_user_id` record the separate "verify
    deployment" step in the delivery workflow (docs/04_ROADMAP.md M6) —
    an operator (or, for a real provider, an automated reachability
    check) confirming the published URL actually serves the site,
    distinct from the provider merely reporting "success". A project
    can only be marked delivered once its live deployment is verified —
    see modules/projects/service.py::mark_delivered.
    """

    __tablename__ = "deployments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    website_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"))
    environment: Mapped[str] = mapped_column(String(20))  # "production" | "preview"
    target: Mapped[str] = mapped_column(String(50), default="mock")  # provider name, e.g. "mock"
    url: Mapped[str | None] = mapped_column(String(500))
    provider_ref: Mapped[str | None] = mapped_column(String(255))  # provider-native deployment id
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|running|success|failed
    result: Mapped[dict | None] = mapped_column(JSON)  # provider-returned detail on success
    error_message: Mapped[str | None] = mapped_column(Text)  # populated on failure

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # == completed_at on success

    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    rollback_of_deployment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("deployments.id", ondelete="SET NULL")
    )

    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    website: Mapped["Website"] = relationship(back_populates="deployments")
    approved_by_user: Mapped["User | None"] = relationship(foreign_keys=[approved_by_user_id])
    verified_by_user: Mapped["User | None"] = relationship(foreign_keys=[verified_by_user_id])
    rollback_of: Mapped["Deployment | None"] = relationship(remote_side=[id])
