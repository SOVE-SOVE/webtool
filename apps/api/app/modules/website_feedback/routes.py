import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.users.models import User
from app.modules.website_feedback import service
from app.modules.website_feedback.schemas import FeedbackCreate, FeedbackRead, FeedbackStatusUpdate

router = APIRouter(tags=["website-feedback"])


# Public — the token in the URL is the credential, same as
# modules/previews/routes.py's GET endpoints.
@router.post("/api/v1/preview/{token}/websites/{website_id}/feedback", response_model=FeedbackRead, status_code=201)
def submit_feedback(token: str, website_id: uuid.UUID, body: FeedbackCreate, db: Session = Depends(get_db)) -> FeedbackRead:
    return service.submit_feedback(db, token, website_id, body)


@router.get("/api/v1/projects/{project_id}/feedback", response_model=list[FeedbackRead])
def list_feedback(
    project_id: uuid.UUID,
    website_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FeedbackRead]:
    items = service.list_feedback(db, current_user.workspace_id, project_id, website_id)
    if items is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return items


@router.patch("/api/v1/feedback/{feedback_id}", response_model=FeedbackRead)
def update_feedback_status(
    feedback_id: uuid.UUID,
    body: FeedbackStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackRead:
    feedback = service.update_feedback_status(db, current_user.workspace_id, current_user.id, feedback_id, body)
    if feedback is None:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return feedback
