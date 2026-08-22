import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.discovery import service as discovery_service
from app.modules.opportunity_scoring import service
from app.modules.opportunity_scoring.schemas import OpportunityScoreResultRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/discovered-businesses/{business_id}/scores", tags=["opportunity-scoring"])


@router.get("", response_model=list[OpportunityScoreResultRead])
def list_score_results(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[OpportunityScoreResultRead]:
    if discovery_service.get_discovered_business(db, current_user.workspace_id, business_id) is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return service.list_score_results(db, business_id)
