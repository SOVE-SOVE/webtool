import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.lead_scores import service
from app.modules.lead_scores.schemas import LeadScoreRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/leads/{lead_id}/scores", tags=["lead_scores"])


@router.get("", response_model=list[LeadScoreRead])
def list_scores(
    lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[LeadScoreRead]:
    scores = service.list_scores(db, current_user.workspace_id, lead_id)
    if scores is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return scores


@router.post("", response_model=LeadScoreRead, status_code=201)
def trigger_score(
    lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LeadScoreRead:
    return service.trigger_score(db, current_user.workspace_id, current_user.id, lead_id)
