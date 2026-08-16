import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.businesses.models import Business
    from app.modules.interactions.models import Interaction
    from app.modules.sales_opportunities.models import SalesOpportunity
    from app.modules.users.models import User
    from app.modules.website_audits.models import WebsiteAudit


class LeadStage(str, enum.Enum):
    """Mirrors the sales half of the pipeline in docs/00_VISION.md."""

    PROSPECT = "prospect"
    RESEARCH = "research"
    WEBSITE_AUDIT = "website_audit"
    LEAD_SCORE = "lead_score"
    SALES_PREPARATION = "sales_preparation"
    OUTREACH = "outreach"
    FOLLOW_UP = "follow_up"
    MEETING = "meeting"
    WON = "won"
    LOST = "lost"


class Lead(Base):
    """The sales-tracking record for a business being pursued."""

    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), unique=True
    )
    stage: Mapped[LeadStage] = mapped_column(Enum(LeadStage, name="lead_stage"), default=LeadStage.PROSPECT)
    score: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str | None] = mapped_column(String(120))
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
