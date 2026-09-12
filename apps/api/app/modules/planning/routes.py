import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.planning import service
from app.modules.planning.schemas import (
    AnalysePlanningRequest,
    PlanningListItem,
    PlanningRead,
    UpdatePlanningRequest,
)
from app.modules.projects.schemas import ProjectRead
from app.modules.users.models import User

router = APIRouter(tags=["planning"])


@router.post("/api/v1/leads/{lead_id}/planning", response_model=PlanningRead)
def start_planning(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Start Planning" — opens (or, the first time, creates) this
    lead's Planning workspace. Cheap and side-effect-free beyond that
    one row, so unlike /analyse this isn't generation-rate-limited."""
    planning = service.start_planning(db, current_user.workspace_id, current_user.id, lead_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return planning


@router.get("/api/v1/leads/{lead_id}/planning", response_model=PlanningRead | None)
def get_planning_for_lead(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead | None:
    try:
        return service.get_planning_for_lead(db, current_user.workspace_id, lead_id)
    except service.LeadNotFoundError:
        raise HTTPException(status_code=404, detail="Lead not found")


@router.post("/api/v1/planning/{planning_id}/analyse", response_model=PlanningRead)
def analyse_planning(
    planning_id: uuid.UUID,
    body: AnalysePlanningRequest = AnalysePlanningRequest(),
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Analyse Website" — the explicit trigger that actually enqueues
    the background audit pipeline. Rate-limited: unlike starting the
    workspace, this is the action that spends LLM calls."""
    try:
        planning = service.run_analysis(
            db, current_user.workspace_id, current_user.id, planning_id, body.website_url
        )
    except service.NoWebsiteUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/review-insights", response_model=PlanningRead)
def run_review_insights(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Run Review Insights" — fetches/refreshes this Lead's Google
    review intelligence and synthesizes it against the workspace's own
    website audit. Rate-limited: calls Google Places and an LLM."""
    planning = service.run_review_insights(db, current_user.workspace_id, current_user.id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.get("/api/v1/planning", response_model=list[PlanningListItem])
def list_planning(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PlanningListItem]:
    return service.list_planning_workspace(db, current_user.workspace_id)


@router.get("/api/v1/planning/{planning_id}", response_model=PlanningRead)
def get_planning(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.get_planning(db, current_user.workspace_id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}", response_model=PlanningRead)
def update_planning(
    planning_id: uuid.UUID,
    body: UpdatePlanningRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = service.update_planning(
        db, current_user.workspace_id, planning_id, body.model_dump(exclude_unset=True)
    )
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.delete("/api/v1/planning/{planning_id}", status_code=204)
def delete_planning(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    removed = service.delete_planning(db, current_user.workspace_id, current_user.id, planning_id)
    if removed is None:
        raise HTTPException(status_code=404, detail="Planning item not found")


@router.post("/api/v1/planning/{planning_id}/create-project", response_model=ProjectRead, status_code=201)
def create_project_from_planning(
    planning_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectRead:
    project = service.create_project_from_planning(db, current_user.workspace_id, current_user.id, planning_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return project
