import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.business_research.models import BusinessResearchResult
from app.modules.business_research.schemas import BusinessResearchResultRead


def list_research_results(db: Session, discovered_business_id: uuid.UUID) -> list[BusinessResearchResultRead]:
    query = (
        select(BusinessResearchResult)
        .where(BusinessResearchResult.discovered_business_id == discovered_business_id)
        .order_by(BusinessResearchResult.researched_at.desc())
    )
    return [BusinessResearchResultRead.from_model(r) for r in db.scalars(query)]


def get_latest_research_result(db: Session, discovered_business_id: uuid.UUID) -> BusinessResearchResult | None:
    return db.scalar(
        select(BusinessResearchResult)
        .where(BusinessResearchResult.discovered_business_id == discovered_business_id)
        .order_by(BusinessResearchResult.researched_at.desc())
        .limit(1)
    )
