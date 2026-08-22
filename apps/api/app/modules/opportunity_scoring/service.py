import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.opportunity_scoring.models import OpportunityScoreResult
from app.modules.opportunity_scoring.schemas import OpportunityScoreResultRead


def list_score_results(db: Session, discovered_business_id: uuid.UUID) -> list[OpportunityScoreResultRead]:
    query = (
        select(OpportunityScoreResult)
        .where(OpportunityScoreResult.discovered_business_id == discovered_business_id)
        .order_by(OpportunityScoreResult.scored_at.desc())
    )
    return [OpportunityScoreResultRead.from_model(r) for r in db.scalars(query)]
