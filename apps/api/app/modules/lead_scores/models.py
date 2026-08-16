import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.leads.models import Lead
    from app.modules.website_audits.models import WebsiteAudit


class ScoreConfidence(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class LeadScore(Base):
    """
    One scoring run for a lead — produced by app.agents.lead_score.
    Deliberately append-only: a new audit or a manual re-score always
    inserts a new row rather than updating the last one, so score
    history is preserved. See docs/05_DECISIONS.md.
    """

    __tablename__ = "lead_scores"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"))
    based_on_audit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("website_audits.id", ondelete="SET NULL")
    )
    overall_score: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[ScoreConfidence] = mapped_column(Enum(ScoreConfidence, name="score_confidence"))
    config_version: Mapped[int] = mapped_column(Integer)
    flagged_for_review: Mapped[bool] = mapped_column(Boolean, default=False)
    results_json: Mapped[dict] = mapped_column(JSONB)  # full LeadScoreOutput — category scores/reasons/warnings
    scored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead: Mapped["Lead"] = relationship(back_populates="lead_scores")
    based_on_audit: Mapped["WebsiteAudit | None"] = relationship()
