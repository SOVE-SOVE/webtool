import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.previews.models import PreviewLink
    from app.modules.projects.models import Project
    from app.modules.users.models import User
    from app.modules.websites.models import Website


class FeedbackType(str, enum.Enum):
    COMMENT = "comment"
    CHANGE_REQUEST = "change_request"
    APPROVAL = "approval"
    REJECTION = "rejection"
    GENERAL = "general"


class FeedbackStatus(str, enum.Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class WebsiteFeedback(Base):
    """
    One row per piece of feedback left on a website preview — Phase 6
    Task 2, "client feedback directly in website previews." Always tied
    to the project and the *exact* website version being viewed (never
    just "the project" — feedback on an old version stops being
    actionable once a new one exists), and to the page/section it was
    left on where the viewer picked one; section-level is optional
    because APPROVAL/REJECTION/GENERAL feedback isn't about one spot on
    the page.

    `preview_link_id` records which link was used to reach this feedback
    (nullable — an operator can also log feedback relayed by phone/email
    on the client's behalf, matching docs/03_AGENT_RULES.md's existing
    "client approval communication" pattern). There's no client login
    (docs/05_DECISIONS.md), so `client_name`/`client_email` are free
    text supplied on the feedback form itself, never a foreign key to a
    user account.
    """

    __tablename__ = "website_feedback"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    website_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("websites.id", ondelete="CASCADE"))
    preview_link_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("preview_links.id", ondelete="SET NULL"))

    page_slug: Mapped[str | None] = mapped_column(String(255))
    section_id: Mapped[str | None] = mapped_column(String(120))

    feedback_type: Mapped[FeedbackType] = mapped_column(Enum(FeedbackType, name="website_feedback_type"))
    message: Mapped[str] = mapped_column(Text)

    client_name: Mapped[str | None] = mapped_column(String(255))
    client_email: Mapped[str | None] = mapped_column(String(255))

    status: Mapped[FeedbackStatus] = mapped_column(
        Enum(FeedbackStatus, name="website_feedback_status"), default=FeedbackStatus.OPEN
    )
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["Project"] = relationship()
    website: Mapped["Website"] = relationship()
    preview_link: Mapped["PreviewLink | None"] = relationship()
    resolved_by_user: Mapped["User | None"] = relationship()
