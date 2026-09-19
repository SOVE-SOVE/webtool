import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.integrations.discovery.registry import UnknownProviderError
from app.modules.discovery import service
from app.modules.discovery.schemas import (
    ReviewQueuePage,
    ApproveResult,
    BulkApproveRequest,
    BulkApproveResult,
    DiscoveredBusinessRead,
    DiscoveredBusinessReviewRead,
    DiscoverySearchCreate,
    DiscoverySearchRead,
    InstagramImportRequest,
    InstagramImportResult,
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


@router.post("/instagram-import", response_model=InstagramImportResult, status_code=201)
def import_instagram_candidates(
    data: InstagramImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InstagramImportResult:
    """
    Phase 1 of Instagram Discovery — turns operator-provided CSV text
    into a discovery search + its candidates, same review/score/CRM-
    import path as every other provider. Not rate-limited like
    `create_discovery_search`: this makes no external API call itself
    (see service.import_instagram_candidates).
    """
    try:
        return service.import_instagram_candidates(db, current_user.workspace_id, current_user.id, data)
    except service.InvalidSearchError as exc:
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
    queued_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DiscoveredBusinessReviewRead]:
    """The dedicated review interface's backing list — every discovered business
    across every search in the workspace, with research/quality/score context.
    `queued_only=true` is the Discovery workspace's Review Queue tab: only
    businesses explicitly added via POST .../queue."""
    return service.list_review_items(
        db, current_user.workspace_id, include_archived=include_archived, queued_only=queued_only
    )


@discovered_businesses_router.get("/review-queue", response_model=ReviewQueuePage)
def list_review_queue_page(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=service.REVIEW_MAX_PAGE_SIZE),
    tab: str = "needs_review",
    search: str | None = Query(None, max_length=200),
    website: Literal["has", "no", "check"] | None = None,
    analysis: Literal["done", "failed", "not_run"] | None = None,
    score: Literal["hot", "warm", "cold", "review", "unscored"] | None = None,
    sort: Literal["score", "newest", "name"] = "score",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReviewQueuePage:
    """One page of the Review Queue with search/filters/sort applied to the
    whole queue first. Declared before `/{business_id}` so it isn't parsed as an id."""
    return service.list_review_queue_page(
        db,
        current_user.workspace_id,
        page=page,
        page_size=page_size,
        tab=tab,
        search=search,
        website=website,
        analysis=analysis,
        score=score,
        sort=sort,
    )


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


@discovered_businesses_router.post("/{business_id}/approve", response_model=ApproveResult)
def approve_business(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ApproveResult:
    """Approve **and** add to the CRM in one step — see
    service.approve_business. 400 if the business is already imported or
    can't be imported."""
    try:
        result = service.approve_business(db, current_user.workspace_id, current_user.id, business_id)
    except (service.InvalidReviewActionError, service.CannotImportError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return result


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


@discovered_businesses_router.post("/{business_id}/queue", response_model=DiscoveredBusinessRead)
def add_to_review_queue(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoveredBusinessRead:
    """Explicit "Add to Review Queue" — Map Discovery's row/popup action.
    Idempotent; never implies approval or import."""
    business = service.add_to_review_queue(db, current_user.workspace_id, current_user.id, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return business


@discovered_businesses_router.delete("/{business_id}/queue", response_model=DiscoveredBusinessRead)
def remove_from_review_queue(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoveredBusinessRead:
    business = service.remove_from_review_queue(db, current_user.workspace_id, current_user.id, business_id)
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


@discovered_businesses_router.post("/{business_id}/check-instagram-website", response_model=DiscoveredBusinessRead)
def check_instagram_website(
    business_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> DiscoveredBusinessRead:
    """
    The manual "check for website" action for an Instagram-sourced
    candidate — an on-demand secondary Brave search for the business's
    own domain. For instagram_search candidates this also runs
    automatically in the background once (see
    jobs/handlers.py::handle_check_instagram_website); this route always
    passes `force=True` so it still works as an explicit retry even if
    that background check already completed. Rate-limited like every
    other endpoint that spends a paid search-API call. 400 if the
    business has no Instagram handle on record.
    """
    try:
        business = service.check_instagram_website(
            db, current_user.workspace_id, current_user.id, business_id, force=True
        )
    except service.NotInstagramCandidateError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if business is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return business
