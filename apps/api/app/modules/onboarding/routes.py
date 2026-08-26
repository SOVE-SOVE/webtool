import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.onboarding import service
from app.modules.onboarding.schemas import OnboardingChecklistRead, OnboardingItemCreate, OnboardingItemUpdate
from app.modules.users.models import User

router = APIRouter(tags=["onboarding"])


@router.get("/api/v1/projects/{project_id}/onboarding", response_model=OnboardingChecklistRead)
def get_checklist(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OnboardingChecklistRead:
    checklist = service.get_checklist(db, current_user.workspace_id, project_id)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return checklist


@router.post(
    "/api/v1/projects/{project_id}/onboarding/items", response_model=OnboardingChecklistRead, status_code=201
)
def add_item(
    project_id: uuid.UUID,
    data: OnboardingItemCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OnboardingChecklistRead:
    checklist = service.add_item(db, current_user.workspace_id, current_user.id, project_id, data)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return checklist


@router.patch("/api/v1/onboarding-items/{item_id}", response_model=OnboardingChecklistRead)
def update_item(
    item_id: uuid.UUID,
    data: OnboardingItemUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OnboardingChecklistRead:
    checklist = service.update_item(db, current_user.workspace_id, current_user.id, item_id, data)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Onboarding item not found")
    return checklist


@router.delete("/api/v1/onboarding-items/{item_id}", response_model=OnboardingChecklistRead)
def delete_item(
    item_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OnboardingChecklistRead:
    checklist = service.delete_item(db, current_user.workspace_id, current_user.id, item_id)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Onboarding item not found")
    return checklist
