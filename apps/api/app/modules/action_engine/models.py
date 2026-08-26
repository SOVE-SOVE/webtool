"""
The daily "Do This Next" queue — a ranked list of the operator's highest-
priority actions across both sides of the business (sales pipeline and
project delivery), recomputed each morning (see service.py's
`generate_queue`) rather than derived live on every page load like
dashboard.get_overview's `needs_attention`. Persisting a run means the
notification engine (modules/notifications) can diff "what's newly on
the list today" against yesterday's run instead of re-deriving it, and
an operator can look back at what the engine surfaced on a prior day.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ActionKind(str, enum.Enum):
    """One entry per example in the phase-7 spec. Kept as an explicit
    enum (rather than a free-text label) so the notification engine and
    the frontend can branch/icon on it without string matching."""

    HOT_LEAD_UNCONTACTED = "hot_lead_uncontacted"
    FOLLOW_UP_OVERDUE = "follow_up_overdue"
    MEETING_APPROACHING = "meeting_approaching"
    PROPOSAL_AWAITING_RESPONSE = "proposal_awaiting_response"
    CLIENT_ASSETS_MISSING = "client_assets_missing"
    WEBSITE_REVISION_AWAITING_APPROVAL = "website_revision_awaiting_approval"
    DEPLOYMENT_FAILED = "deployment_failed"
    # Not one of the seven spec examples, but "deadline" is one of the
    # four ranking factors and modules/notifications lists
    # "project deadline" as its own notification type — a project
    # closing in on its deadline needs to surface as its own queue item,
    # not just as a weighting factor on other items.
    PROJECT_DEADLINE_APPROACHING = "project_deadline_approaching"


class DailyActionRun(Base):
    """One snapshot of the queue for a workspace. `generated_at` is what
    "every morning" means in practice — a new run each time the engine
    is (re)run, not a continuously-mutating single row."""

    __tablename__ = "daily_action_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0)

    items: Mapped[list["ActionQueueItem"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="ActionQueueItem.rank"
    )


class ActionQueueItem(Base):
    """
    A single ranked action within a run. `entity_type`/`entity_id` point
    back at the real row that produced this item (a Lead, FollowUp,
    Meeting, ...) — same "link back to the real thing, no fabricated
    detail" convention as dashboard.AttentionItem, just persisted.

    The four scored factors are stored individually (not just the final
    `priority_score`) so the ranking is auditable — an operator or a
    future test can see *why* something ranked where it did, not just
    that it did.
    """

    __tablename__ = "action_queue_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("daily_action_runs.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)

    kind: Mapped[ActionKind] = mapped_column(Enum(ActionKind, name="action_kind"))
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))

    title: Mapped[str] = mapped_column(String(255))
    detail: Mapped[str] = mapped_column(Text)
    action_text: Mapped[str] = mapped_column(Text)
    href: Mapped[str] = mapped_column(String(255))

    urgency_score: Mapped[int] = mapped_column(Integer)
    opportunity_score: Mapped[int] = mapped_column(Integer)
    deadline_score: Mapped[int] = mapped_column(Integer)
    pipeline_value_cents: Mapped[int] = mapped_column(Integer, default=0)
    priority_score: Mapped[float] = mapped_column(Float)
    rank: Mapped[int] = mapped_column(Integer)

    run: Mapped["DailyActionRun"] = relationship(back_populates="items")
