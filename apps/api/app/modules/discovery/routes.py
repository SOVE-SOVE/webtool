import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.integrations.discovery.registry import UnknownProviderError
from app.modules.discovery import service
from app.modules.discovery.schemas import (
    BulkApproveRequest,
    BulkApproveResult,
    DiscoveredBusinessRead,
    DiscoveredBusinessReviewRead,
    DiscoverySearchCreate,
    DiscoverySearchRead,
    ScheduledSearchRead,
    ScheduleRecurringSearchRequest,
)
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
    Creates and immediately runs a search — synchronous, the provider call
    is a single bounded HTTP request, same shape as Sales Audit
    generation. Every discovered business it finds then flows on its own
    through research -> analysis -> scoring via the `jobs` queue (see
    app/modules/jobs/ and app/jobs/handlers.py) — see `schedule` below
    for a search that runs on its own on a recurring cadence instead of
    once, right now.
    """
    try:
        return service.create_and_run_search(db, current_user.workspace_id, current_user.id, data)
    except service.InvalidSearchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except UnknownProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/schedule", response_model=ScheduledSearchRead, status_code=201)
def schedule_recurring_search(
    data: ScheduleRecurringSearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScheduledSearchRead:
    """
    Scheduled discovery: enqueues the same search criteria as a job that
    runs on its own every `interval_hours`, re-enqueueing its own next
    run each time it completes — see
    `app/jobs/handlers.py::handle_discovery_search`. Requires a job
    poller process running (`python -m app.jobs.runner`) to actually
    execute; the row exists the moment this returns either way.
    """
    try:
        job = service.schedule_recurring_search(
            db, current_user.workspace_id, current_user.id, data, interval_hours=data.interval_hours
        )
    except service.InvalidSearchError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return job


@router.get("/schedule", response_model=list[ScheduledSearchRead])
def list_scheduled_searches(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ScheduledSearchRead]:
    return service.list_scheduled_searches(db, current_user.workspace_id)


@router.get("/{search_id}", response_model=DiscoverySearchRead)
def get_discovery_search(
    search_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoverySearchRead:
    search = service.get_discovery_search(db, current_user.workspace_id, search_id)
    if search is None:
        raise HTTPException(status_code=404, detail="Discovery search not found")
    return search


@router.post("/{search_id}/load-more", response_model=DiscoverySearchRead)
def load_more_results(
    search_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> DiscoverySearchRead:
    """
    Fetch the next page of results for an existing search and append the
    new businesses to it — same criteria, so search/website filters
    carry over automatically. 409 when the provider has no further pages.
    """
    try:
        return service.load_more_search(db, current_user.workspace_id, current_user.id, search_id)
    except service.SearchNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.NoMoreResultsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


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
