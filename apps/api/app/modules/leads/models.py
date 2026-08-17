import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.businesses.models import Business
    from app.modules.interactions.models import Interaction
    from app.modules.sales_audits.models import SalesAuditReport
    from app.modules.sales_opportunities.models import SalesOpportunity
    from app.modules.users.models import User
    from app.modules.website_audits.models import WebsiteAudit


class LeadStatus(str, enum.Enum):
    """
    A lead's own CRM-style status, distinct from the delivery-side
    ProjectStage pipeline. Supersedes the earlier pipeline-shaped
    LeadStage — see docs/05_DECISIONS.md.
    """

    NEW = "new"
    RESEARCHED = "researched"
    QUALIFIED = "qualified"
    CONTACTED = "contacted"
    REPLIED = "replied"
    MEETING = "meeting"
    PROPOSAL = "proposal"
    WON = "won"
    LOST = "lost"
    NURTURE = "nurture"


class LeadPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Lead(Base):
    """The sales-tracking record for a business being pursued."""

    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), unique=True
    )
    status: Mapped[LeadStatus] = mapped_column(Enum(LeadStatus, name="lead_status"), default=LeadStatus.NEW)
    priority: Mapped[LeadPriority] = mapped_column(
        Enum(LeadPriority, name="lead_priority"), default=LeadPriority.MEDIUM
    )
    score: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    business: Mapped["Business"] = relationship(back_populates="lead")
    assigned_user: Mapped["User | None"] = relationship()
    interactions: Mapped[list["Interaction"]] = relationship(back_populates="lead")
    website_audits: Mapped[list["WebsiteAudit"]] = relationship(back_populates="lead")
    sales_opportunities: Mapped[list["SalesOpportunity"]] = relationship(back_populates="lead")
    sales_audit_reports: Mapped[list["SalesAuditReport"]] = relationship(back_populates="lead")
