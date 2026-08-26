import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class PreviewAudience(str, enum.Enum):
    CLIENT = "client"
    INTERNAL = "internal"


class PreviewLink(Base):
    """
    A secure, tokenized share link for a project's website previews —
    roadmap M5's last open item ("a secure shareable client-preview link
    with feedback capture"). One row per generated link, not per website
    version: `project_id`-scoped so the same link supports "version
    selection" across every version of that project's website, filtered
    by audience at read time (modules/previews/service.py's
    `_is_visible`) rather than pinned to one version at creation.

    The link itself never sits in the database in plaintext beyond the
    moment it's minted — `token_hash` is a SHA-256 digest of the actual
    token (a high-entropy `secrets.token_urlsafe` value, not a
    user-chosen secret that needs bcrypt's slow hashing), looked up by
    exact match on every preview request. `token_suffix` is the last 6
    characters kept in plaintext purely so an operator can tell several
    links for the same project apart in a list — negligible entropy loss
    against a 43-character token. A CLIENT audience link only ever
    resolves website versions the operator has already signed off on
    (`Website.approved`) — "do not expose unpublished websites publicly"
    is enforced here, not just in the UI. An INTERNAL audience link can
    preview any version, including a bare draft, since it's for the
    team's own review and is never handed to a client.
    """

    __tablename__ = "preview_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    token_suffix: Mapped[str] = mapped_column(String(8))
    audience: Mapped[PreviewAudience] = mapped_column(Enum(PreviewAudience, name="preview_audience"))
    label: Mapped[str | None] = mapped_column(String(255))

    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Expiration/revocation — a link is dead if either is set (revocation
    # is explicit and immediate; expiry is a standing time bound checked
    # at read time, never swept/deleted so the operator can still see it
    # in the list).
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    access_count: Mapped[int] = mapped_column(Integer, default=0)

    project: Mapped["Project"] = relationship()
    created_by_user: Mapped["User | None"] = relationship(foreign_keys=[created_by_user_id])
    revoked_by_user: Mapped["User | None"] = relationship(foreign_keys=[revoked_by_user_id])
