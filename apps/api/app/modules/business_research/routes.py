import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.business_research import service
from app.modules.business_research.schemas import BusinessResearchResultRead
from app.modules.discovery import service as discovery_service
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/discovered-businesses/{business_id}/research", tags=["business-research"])


@router.get("", response_model=list[BusinessResearchResultRead])
def list_research_results(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[BusinessResearchResultRead]:
    if discovery_service.get_discovered_business(db, current_user.workspace_id, business_id) is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return service.list_research_results(db, business_id)


@router.post("", response_model=BusinessResearchResultRead)
def run_research(
    business_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> BusinessResearchResultRead:
    """Returns a fresh-enough cached result instead of re-researching —
    see service.RESEARCH_FRESHNESS."""
    result = service.run_research(db, current_user.workspace_id, current_user.id, business_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return result
