import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.users.models import User
    from app.modules.websites.models import Website


class Deployment(Base):
    """
    One row per deploy event for a website — approval checkpoint 7
    ("Final deployment", docs/05_DECISIONS.md's human-approval-workflow
    entry). Creating a row IS the approval record (who/when/notes) for
    this checkpoint: modules/deployments/service.py refuses to create
    one at all unless every prior checkpoint (brief, creative direction,
    sitemap, generated website, QA, client review) is currently
    approved for this project — see modules/approvals/service.py. No
    real hosting/publish action happens yet (`status` stays "pending" —
    roadmap M6, "do not add automatic deployment yet").
    """

    __tablename__ = "deployments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    website_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"))
    environment: Mapped[str] = mapped_column(String(20))  # "production" | "preview"
    url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|success|failed
    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    website: Mapped["Website"] = relationship(back_populates="deployments")
    approved_by_user: Mapped["User | None"] = relationship()
