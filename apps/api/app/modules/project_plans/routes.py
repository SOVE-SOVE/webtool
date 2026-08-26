import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.project_plans import service
from app.modules.project_plans.schemas import PlanStageRead, PlanStageUpdate, ProjectPlanRead
from app.modules.users.models import User

router = APIRouter(tags=["project-plans"])


@router.get("/api/v1/projects/{project_id}/plan", response_model=ProjectPlanRead)
def get_plan(
    project_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProjectPlanRead:
    plan = service.get_plan(db, current_user.workspace_id, project_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return plan


@router.patch("/api/v1/project-plan-stages/{stage_plan_id}", response_model=PlanStageRead)
def update_stage(
    stage_plan_id: uuid.UUID,
    data: PlanStageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanStageRead:
    stage_plan = service.update_stage(db, current_user.workspace_id, current_user.id, stage_plan_id, data)
    if stage_plan is None:
        raise HTTPException(status_code=404, detail="Plan stage not found")
    return stage_plan


@router.post("/api/v1/project-plan-stages/{stage_plan_id}/approve", response_model=PlanStageRead)
def approve_stage(
    stage_plan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanStageRead:
    stage_plan = service.approve_stage(db, current_user.workspace_id, current_user.id, stage_plan_id)
    if stage_plan is None:
        raise HTTPException(status_code=404, detail="Plan stage not found")
    return stage_plan
