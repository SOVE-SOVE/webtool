import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.discovery import service as discovery_service
from app.modules.review_intelligence import service
from app.modules.review_intelligence.schemas import ReviewIntelligenceResultRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/discovered-businesses/{business_id}/review-intelligence", tags=["review-intelligence"])


@router.get("", response_model=list[ReviewIntelligenceResultRead])
def list_review_intelligence(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ReviewIntelligenceResultRead]:
    if discovery_service.get_discovered_business(db, current_user.workspace_id, business_id) is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return service.list_review_intelligence_results(db, business_id)


@router.post("", response_model=ReviewIntelligenceResultRead)
def run_review_intelligence(
    business_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> ReviewIntelligenceResultRead:
    """Returns a fresh-enough cached result instead of re-fetching from
    Google — see service.REVIEW_INTELLIGENCE_FRESHNESS."""
    result = service.run_review_intelligence(db, current_user.workspace_id, current_user.id, business_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return result
