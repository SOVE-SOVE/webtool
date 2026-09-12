import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.integrations.discovery.base import ProviderUnavailableError
from app.modules.planning import service
from app.modules.planning.schemas import (
    AnalysePlanningRequest,
    PlanningListItem,
    PlanningRead,
    UpdateComparableSiteRequest,
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


@router.post("/api/v1/planning/{planning_id}/generate-website-plan", response_model=PlanningRead)
def generate_website_plan(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Generate Website Plan" — New Website Plan mode's core action,
    for a Lead with no website to audit. Rate-limited: calls an LLM."""
    planning = service.generate_website_plan(db, current_user.workspace_id, current_user.id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/comparable-sites/search", response_model=PlanningRead)
def search_comparable_sites(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Research Comparable Websites" (search step) — one call to the
    same discovery provider adapters Discovery already uses. Rate-
    limited: calls a paid search API, same as a Discovery search."""
    try:
        planning = service.search_comparable_sites(db, current_user.workspace_id, current_user.id, planning_id)
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.patch("/api/v1/planning/{planning_id}/comparable-sites/{site_id}", response_model=PlanningRead)
def update_comparable_site(
    planning_id: uuid.UUID,
    site_id: uuid.UUID,
    body: UpdateComparableSiteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Include/exclude a candidate reference site before analysis."""
    planning = service.update_comparable_site(
        db, current_user.workspace_id, planning_id, site_id, body.included
    )
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item or comparable site not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/comparable-sites/analyse", response_model=PlanningRead)
def analyse_comparable_sites(
    planning_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """"Research Comparable Websites" (analyse step) — enqueues the
    background job that fetches each included site's public homepage
    and synthesizes market patterns/opportunities. Rate-limited: this
    is the action that spends LLM calls."""
    try:
        planning = service.run_comparable_analysis(db, current_user.workspace_id, current_user.id, planning_id)
    except service.NoComparableSitesIncludedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
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
