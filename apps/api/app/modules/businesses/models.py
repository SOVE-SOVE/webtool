import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.clients.models import Client
    from app.modules.contacts.models import Contact
    from app.modules.leads.models import Lead
    from app.modules.workspaces.models import Workspace


class Business(Base):
    """
    The canonical company record — a prospect, a client, or both over
    time. Scoped to a workspace; every descendant table (leads,
    clients, projects, ...) reaches its workspace by following its FK
    chain up to here rather than duplicating workspace_id — see
    docs/02_ARCHITECTURE.md §3.
    """

    __tablename__ = "businesses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    industry: Mapped[str | None] = mapped_column(String(120))
    website_url: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(50))
    suburb: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(10))
    postcode: Mapped[str | None] = mapped_column(String(10))
    abn: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    workspace: Mapped["Workspace"] = relationship()
    contacts: Mapped[list["Contact"]] = relationship(back_populates="business")
    lead: Mapped["Lead | None"] = relationship(back_populates="business", uselist=False)
    client: Mapped["Client | None"] = relationship(back_populates="business", uselist=False)
