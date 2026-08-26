import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.integrations.discovery.registry import UnknownProviderError
from app.modules.discovery import automation as discovery_automation, service
from app.modules.discovery.schemas import (
    BulkApproveRequest,
    BulkApproveResult,
    DiscoveredBusinessRead,
    DiscoveredBusinessReviewRead,
    DiscoverySearchCreate,
    DiscoverySearchRead,
    LeadDiscoveryScheduleCreate,
    LeadDiscoveryScheduleRead,
    LeadDiscoveryScheduleUpdate,
)
from app.modules.jobs import service as jobs_service
from app.modules.jobs.schemas import JobRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/discovery-searches", tags=["discovery"])


@router.get("", response_model=list[DiscoverySearchRead])
def list_discovery_searches(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DiscoverySearchRead]:
    return service.list_discovery_searches(db, current_user.workspace_id)


@router.post("", response_model=DiscoverySearchRead, status_code=201)
def create_discovery_search(
    data: DiscoverySearchCreate,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> DiscoverySearchRead:
    """
    Creates and immediately runs a search — synchronous for now (the
    provider call is a single bounded HTTP request, same shape as Sales
    Audit generation). The `jobs` queue (see app/modules/jobs/) exists
    for a future asynchronous/scheduled path without needing a route
    change; nothing here uses it yet.
    """
    try:
        return service.create_and_run_search(db, current_user.workspace_id, current_user.id, data)
    except service.InvalidSearchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except UnknownProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{search_id}", response_model=DiscoverySearchRead)
def get_discovery_search(
    search_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoverySearchRead:
    search = service.get_discovery_search(db, current_user.workspace_id, search_id)
    if search is None:
        raise HTTPException(status_code=404, detail="Discovery search not found")
    return search


@router.get("/{search_id}/results", response_model=list[DiscoveredBusinessRead])
def list_discovered_businesses(
    search_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DiscoveredBusinessRead]:
    results = service.list_discovered_businesses(db, current_user.workspace_id, search_id)
    if results is None:
        raise HTTPException(status_code=404, detail="Discovery search not found")
    return results


discovered_businesses_router = APIRouter(prefix="/api/v1/discovered-businesses", tags=["discovery"])


class RejectRequest(BaseModel):
    notes: str | None = None


@discovered_businesses_router.get("", response_model=list[DiscoveredBusinessReviewRead])
def list_review_items(
    include_archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DiscoveredBusinessReviewRead]:
    """The dedicated review interface's backing list — every discovered business
    across every search in the workspace, with research/quality/score context."""
    return service.list_review_items(db, current_user.workspace_id, include_archived=include_archived)


@discovered_businesses_router.post("/bulk-approve", response_model=BulkApproveResult)
def bulk_approve(
    data: BulkApproveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BulkApproveResult:
    return service.bulk_approve(db, current_user.workspace_id, current_user.id, data.business_ids)


@discovered_businesses_router.get("/{business_id}", response_model=DiscoveredBusinessRead)
def get_discovered_business(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoveredBusinessRead:
    business = service.get_discovered_business(db, current_user.workspace_id, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return business


@discovered_businesses_router.post("/{business_id}/approve", response_model=DiscoveredBusinessRead)
def approve_business(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoveredBusinessRead:
    try:
        business = service.approve_business(db, current_user.workspace_id, current_user.id, business_id)
    except service.InvalidReviewActionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if business is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return business


@discovered_businesses_router.post("/{business_id}/reject", response_model=DiscoveredBusinessRead)
def reject_business(
    business_id: uuid.UUID,
    data: RejectRequest = RejectRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DiscoveredBusinessRead:
    try:
        business = service.reject_business(db, current_user.workspace_id, current_user.id, business_id, data.notes)
    except service.InvalidReviewActionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if business is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return business


@discovered_businesses_router.post("/{business_id}/archive", response_model=DiscoveredBusinessRead)
def archive_business(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoveredBusinessRead:
    try:
        business = service.archive_business(db, current_user.workspace_id, current_user.id, business_id)
    except service.InvalidReviewActionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if business is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return business


@discovered_businesses_router.post("/{business_id}/import", response_model=DiscoveredBusinessRead)
def import_to_lead(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoveredBusinessRead:
    try:
        business = service.import_to_lead(db, current_user.workspace_id, current_user.id, business_id)
    except service.CannotImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except service.DuplicateLeadError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if business is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return business


discovery_schedules_router = APIRouter(prefix="/api/v1/discovery-schedules", tags=["discovery", "jobs"])


@discovery_schedules_router.get("", response_model=list[LeadDiscoveryScheduleRead])
def list_discovery_schedules(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[LeadDiscoveryScheduleRead]:
    return [
        LeadDiscoveryScheduleRead.from_model(s)
        for s in discovery_automation.list_discovery_schedules(db, current_user.workspace_id)
    ]


@discovery_schedules_router.post("", response_model=LeadDiscoveryScheduleRead, status_code=201)
def create_discovery_schedule(
    data: LeadDiscoveryScheduleCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LeadDiscoveryScheduleRead:
    schedule = discovery_automation.create_discovery_schedule(db, current_user.workspace_id, current_user.id, data)
    return LeadDiscoveryScheduleRead.from_model(schedule)


@discovery_schedules_router.get("/{schedule_id}", response_model=LeadDiscoveryScheduleRead)
def get_discovery_schedule(
    schedule_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LeadDiscoveryScheduleRead:
    schedule = discovery_automation.get_discovery_schedule(db, current_user.workspace_id, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Discovery schedule not found")
    return LeadDiscoveryScheduleRead.from_model(schedule)


@discovery_schedules_router.patch("/{schedule_id}", response_model=LeadDiscoveryScheduleRead)
def update_discovery_schedule(
    schedule_id: uuid.UUID,
    data: LeadDiscoveryScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LeadDiscoveryScheduleRead:
    schedule = discovery_automation.get_discovery_schedule(db, current_user.workspace_id, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Discovery schedule not found")
    updated = discovery_automation.update_discovery_schedule(db, schedule, data)
    return LeadDiscoveryScheduleRead.from_model(updated)


@discovery_schedules_router.delete("/{schedule_id}", status_code=204)
def delete_discovery_schedule(
    schedule_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    schedule = discovery_automation.get_discovery_schedule(db, current_user.workspace_id, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Discovery schedule not found")
    jobs_service.delete_schedule(db, schedule)


@discovery_schedules_router.post("/{schedule_id}/run-now", response_model=JobRead, status_code=201)
def run_discovery_schedule_now(
    schedule_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> JobRead:
    schedule = discovery_automation.get_discovery_schedule(db, current_user.workspace_id, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Discovery schedule not found")
    return jobs_service.run_schedule_now(db, schedule)
