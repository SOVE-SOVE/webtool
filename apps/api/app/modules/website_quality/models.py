import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.business_research.models import BusinessResearchResult
    from app.modules.discovery.models import DiscoveredBusiness


class WebsiteQualityAudit(Base):
    """
    Structured quality findings derived from a `BusinessResearchResult`
    — docs/04_ROADMAP.md Lead Intelligence stage 3. `findings` is JSON
    (list of {category, severity, evidence, confidence, message}),
    same precedent as `QaReport.report`: a generated, non-operator-edited
    structured list, not prose a human writes by hand. Never invents a
    measurement research didn't actually take — a signal research
    couldn't determine simply produces no finding for that category,
    rather than a guessed one.
    """

    __tablename__ = "website_quality_audits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    discovered_business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("discovered_businesses.id", ondelete="CASCADE")
    )
    business_research_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("business_research_results.id", ondelete="SET NULL")
    )

    findings: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[str | None] = mapped_column(Text)
    issue_count: Mapped[int] = mapped_column(Integer, default=0)
    critical_count: Mapped[int] = mapped_column(Integer, default=0)

    audited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    discovered_business: Mapped["DiscoveredBusiness"] = relationship(back_populates="quality_audits")
    business_research: Mapped["BusinessResearchResult | None"] = relationship()
