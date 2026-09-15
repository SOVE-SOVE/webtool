import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.users.models import User


class Workspace(Base):
    """The shared tenant boundary — one per business, per docs/01_REQUIREMENTS.md."""

    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    # ISO-4217 currency code and IANA timezone name used for all money
    # display and for computing "today" in overdue/billing-date math
    # (see app/modules/billing). Defaults match the operator's actual
    # location; there's no signup flow to collect these at, so every
    # workspace starts here and can change it in Settings.
    currency: Mapped[str] = mapped_column(String(3), server_default="AUD", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), server_default="Australia/Brisbane", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    users: Mapped[list["User"]] = relationship(back_populates="workspace")
