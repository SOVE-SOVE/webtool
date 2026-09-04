import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.users.models import User
    from app.modules.websites.models import Website


class RevisionStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REVERTED = "reverted"


class RevisionKind(str, enum.Enum):
    # A targeted, LLM-guided edit to one section's content/tone/copy.
    CONTENT = "content"
    # A deterministic spacing toggle — no LLM call, see
    # modules/website_revisions/service.py.
    SPACING = "spacing"
    # An explicit undo of an earlier revision.
    ROLLBACK = "rollback"


class WebsiteRevision(Base):
    """
    One entry in a project's revision history (Phase 5 Part 3 Task 2):
    an operator's free-text feedback on a generated website, the change
    actually made in response, and whether the operator has approved or
    rolled it back. `revision_number` is sequential per project (1, 2,
    3, ...), independent of how many `Website` version rows exist —
    every revision produces exactly one new `Website` row (never edits
    an existing one in place), same "new row per real change" convention
    as `Website`/`CreativeDirectionBrief`/`Sitemap` themselves, so a
    prior state is never lost.

    `previous_website_id` is the version this revision started from;
    `resulting_website_id` is the version it produced. Rolling back a
    revision doesn't rewrite either of those pointers or this row's own
    history — it creates a *new* `WebsiteRevision` row (kind=ROLLBACK)
    whose `resulting_website_id` restores `previous_website_id`'s
    config, and marks this row REVERTED. See service.py.
    """

    __tablename__ = "website_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    revision_number: Mapped[int] = mapped_column(Integer)

    kind: Mapped[RevisionKind] = mapped_column(Enum(RevisionKind, name="website_revision_kind"))
    status: Mapped[RevisionStatus] = mapped_column(
        Enum(RevisionStatus, name="website_revision_status"), default=RevisionStatus.PENDING
    )

    # Null for a targeted section edit's target when the feedback is a
    # site-wide spacing toggle (see RevisionKind.SPACING) or a rollback.
    section_id: Mapped[str | None] = mapped_column(String(64))
    section_type: Mapped[str | None] = mapped_column(String(60))
    page_name: Mapped[str | None] = mapped_column(String(200))

    requested_change: Mapped[str] = mapped_column(Text)
    generated_change: Mapped[str] = mapped_column(Text)

    previous_website_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("websites.id", ondelete="SET NULL"))
    resulting_website_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("websites.id", ondelete="SET NULL"))

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_notes: Mapped[str | None] = mapped_column(Text)

    previous_website: Mapped["Website | None"] = relationship(foreign_keys=[previous_website_id])
    resulting_website: Mapped["Website | None"] = relationship(foreign_keys=[resulting_website_id])
    created_by_user: Mapped["User | None"] = relationship(foreign_keys=[created_by_user_id])
    decided_by_user: Mapped["User | None"] = relationship(foreign_keys=[decided_by_user_id])
