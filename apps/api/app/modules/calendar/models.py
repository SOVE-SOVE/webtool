import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.users.models import User


class CalendarConnection(Base):
    """
    One user's connected Google Calendar. Per-user (not per-workspace) —
    a meeting's calendar event lands on whoever is actually assigned to
    it, not a shared workspace calendar. The refresh token is the only
    long-lived credential kept; access tokens are fetched on demand and
    never persisted. See app/core/crypto.py: encrypted_refresh_token is
    Fernet-encrypted, never plaintext, per docs/06_SECURITY.md.
    """

    __tablename__ = "calendar_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    provider: Mapped[str] = mapped_column(String(20), default="google")
    google_email: Mapped[str | None] = mapped_column(String(255))
    encrypted_refresh_token: Mapped[str] = mapped_column(Text)
    calendar_id: Mapped[str] = mapped_column(String(255), default="primary")
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship()
