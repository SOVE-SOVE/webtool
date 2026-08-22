import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Float, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.modules.discovery.models import OpportunityScoreCategory

if TYPE_CHECKING:
    from app.modules.discovery.models import DiscoveredBusiness


class OpportunityScoreResult(Base):
    """
    A transparent, explainable score run for one `DiscoveredBusiness` —
    docs/04_ROADMAP.md Lead Intelligence stage 4. Mirrors
    `agents/lead_score.py`'s "deterministic rules, reasons list" shape
    but keeps full history (a business can be rescored after new
    research) and a structured factor breakdown, not just a number.
    `factors` is JSON (list of {factor, points, direction, explanation})
    — same "generated structured list" precedent as
    WebsiteQualityAudit.findings/QaReport.report — so every point on the
    score traces back to a named, human-readable reason. The operator
    must never see a bare number with no explanation for it.
    """

    __tablename__ = "opportunity_score_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    discovered_business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("discovered_businesses.id", ondelete="CASCADE")
    )

    overall_score: Mapped[int] = mapped_column(Integer)
    category: Mapped[OpportunityScoreCategory] = mapped_column(
        Enum(OpportunityScoreCategory, name="opportunity_score_category")
    )
    confidence: Mapped[float] = mapped_column(Float)

    positive_signals: Mapped[str | None] = mapped_column(Text)
    negative_signals: Mapped[str | None] = mapped_column(Text)
    factors: Mapped[list] = mapped_column(JSON, default=list)
    recommendation_reason: Mapped[str] = mapped_column(Text)

    scored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    discovered_business: Mapped["DiscoveredBusiness"] = relationship(back_populates="score_results")
