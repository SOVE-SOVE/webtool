import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.integrations.discovery import registry
from app.integrations.discovery.base import (
    DiscoveryCriteria,
    DiscoveryPage,
    NormalizedBusinessResult,
    ProviderUnavailableError,
    WebsiteStatus,
)
from app.modules.activity_log import service as activity_service
from app.modules.business_research import service as business_research_service
from app.modules.businesses.models import Business
from app.modules.discovery import dedup
from app.modules.discovery.instagram_import import parse_instagram_csv
from app.modules.discovery.models import (
    DiscoveredBusiness,
    DiscoveredBusinessStatus,
    DiscoverySearch,
    DiscoverySearchStatus,
    OpportunityScoreCategory,
)
from app.modules.discovery.schemas import (
    ApproveResult,
    BulkApproveFailure,
    BulkApproveResult,
    DiscoveredBusinessRead,
    DiscoveredBusinessReviewRead,
    DiscoverySearchCreate,
    DiscoverySearchRead,
    InstagramImportRequest,
    InstagramImportResult,
    InstagramImportRowError,
)
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import (
    DEFAULT_DISCOVERY_INTERVAL_HOURS,
    JOB_BUSINESS_RESEARCH,
    JOB_DISCOVERY_SEARCH,
)
from app.modules.jobs.models import Job, JobStatus
from app.modules.leads.models import Lead, LeadPriority
from app.modules.opportunity_scoring.models import OpportunityScoreResult
from app.modules.website_audits.models import WebsiteAudit
from app.modules.website_quality.models import WebsiteQualityAudit

MAX_RESULTS_PER_SEARCH = 20

# A search that has pulled this many provider pages stops offering "load
# more" regardless of what the provider reports — a guard against a
# provider that always claims has_more. Ten pages of ~20 is well past
# what an operator reviews by hand.
MAX_PAGES_PER_SEARCH = 10

# Terminal states a business shouldn't move out of via approve/reject/
# archive — a decision already made stands until import (or a future
# "reconsider" action, not built in this pass — see the docstring on
# why unarchive isn't either).
_REVIEW_ACTION_BLOCKED_STATUSES = (DiscoveredBusinessStatus.IMPORTED,)
_NOT_IMPORTABLE_STATUSES = (
    DiscoveredBusinessStatus.REJECTED,
    DiscoveredBusinessStatus.ARCHIVED,
    DiscoveredBusinessStatus.IMPORTED,
)
_CATEGORY_TO_PRIORITY = {
    OpportunityScoreCategory.HOT: LeadPriority.HIGH,
    OpportunityScoreCategory.WARM: LeadPriority.MEDIUM,
    OpportunityScoreCategory.COLD: LeadPriority.LOW,
    OpportunityScoreCategory.REVIEW: LeadPriority.MEDIUM,
}


class InvalidReviewActionError(ValueError):
    """Raised by approve/reject/archive on a business already IMPORTED —
    a decision already acted on in the CRM can't be revised here."""


class CannotImportError(ValueError):
    """Raised by import_to_lead for a business that's REJECTED, ARCHIVED, or already IMPORTED."""


class DuplicateLeadError(ValueError):
    """Raised by import_to_lead when the matching CRM business already
    has a lead — importing again would create a second lead for the
    same business, which the CRM schema doesn't allow (one active lead
    per business) and which the "prevent duplicate leads" requirement
    forbids outright."""


class InvalidSearchError(ValueError):
    """No usable criteria on the request — see create_and_run_search."""


class SearchNotFoundError(ValueError):
    """load_more_search: the search id isn't in this workspace."""


class NoMoreResultsError(ValueError):
    """load_more_search: the provider has no further pages for this search."""


def _criteria_for(search: DiscoverySearch, offset: int) -> DiscoveryCriteria:
    return DiscoveryCriteria(
        location=search.location,
        industry=search.industry,
        business_type=search.business_type,
        keywords=search.keywords,
        limit=MAX_RESULTS_PER_SEARCH,
        offset=offset,
    )


def _apply_website_status(results: list[NormalizedBusinessResult]) -> None:
    """A usable URL means FOUND; a provider that positively reports "no
    website" keeps its NONE; anything else is UNKNOWN (a business with no
    website we've merely not seen — still a valid lead, never discarded)."""
    for result in results:
        if result.website_url:
            result.website_status = WebsiteStatus.FOUND
        elif result.website_status == WebsiteStatus.FOUND:
            result.website_status = WebsiteStatus.UNKNOWN


def _filter_by_website(
    results: list[NormalizedBusinessResult], has_website: bool | None
) -> list[NormalizedBusinessResult]:
    """The optional "website" search filter. True keeps only a confirmed
    website; False keeps only a *confirmed* absence (never the UNKNOWNs —
    we don't claim a business has no site without evidence, and we don't
    hide it either: it shows under an unfiltered search). None = no filter."""
    if has_website is True:
        return [r for r in results if r.website_status == WebsiteStatus.FOUND]
    if has_website is False:
        return [r for r in results if r.website_status == WebsiteStatus.NONE]
    return results


def _ingest_page(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    search: DiscoverySearch,
    page: DiscoveryPage,
    offset: int,
) -> list[DiscoveredBusiness]:
    """
    Persist one provider page onto `search`, growing it in place:
    normalize + website-filter the results, drop any whose URL is
    already a row on this search (no duplicate results across pages),
    dedup the rest against the workspace, create rows, and advance the
    search's pagination bookkeeping. Returns the new rows (not yet
    committed) so the caller can enqueue research after commit.
    """
    _apply_website_status(page.results)
    results = _filter_by_website(page.results, search.has_website)

    # No duplicate results across pages of one search: a provider can and
    # does re-surface the same listing on a later page. Key on a stable
    # identifier the result actually carries — the provider's own id or
    # the website URL. A name+location key is only safe when the result
    # has real location context (see dedup.py: a provider that never
    # fills suburb/state collides genuinely different same-named
    # businesses), so it's used only then.
    existing = db.execute(
        select(
            DiscoveredBusiness.source_external_id,
            DiscoveredBusiness.website_url,
        ).where(DiscoveredBusiness.discovery_search_id == search.id)
    ).all()
    seen_keys: set[str] = {k for row in existing for k in row if k}
    seen_located_keys: set[str] = {
        b.dedup_key
        for b in db.scalars(
            select(DiscoveredBusiness).where(
                DiscoveredBusiness.discovery_search_id == search.id,
                (DiscoveredBusiness.suburb.is_not(None)) | (DiscoveredBusiness.state.is_not(None)),
            )
        )
    }

    def _keys_for(result: NormalizedBusinessResult) -> list[str]:
        return [k for k in (result.source_external_id, result.website_url) if k]

    query_sent = " ".join(
        p for p in (search.industry, search.business_type, search.keywords, search.location) if p
    )

    created: list[DiscoveredBusiness] = []
    for result in results:
        dedup_key = dedup.compute_dedup_key(result.name, result.suburb, result.state)
        keys = _keys_for(result)
        has_location = bool((result.suburb or "").strip() or (result.state or "").strip())
        if any(k in seen_keys for k in keys) or (has_location and dedup_key in seen_located_keys):
            continue
        seen_keys.update(keys)
        if has_location:
            seen_located_keys.add(dedup_key)

        duplicate_of_business = dedup.find_existing_business_match(db, workspace_id, result)
        duplicate_of_discovered = (
            None
            if duplicate_of_business is not None
            else dedup.find_duplicate_discovered_business(db, workspace_id, result, dedup_key)
        )

        business = DiscoveredBusiness(
            discovery_search_id=search.id,
            name=result.name,
            industry=result.industry,
            website_url=result.website_url,
            website_status=result.website_status,
            phone=result.phone,
            email=result.email,
            address=result.address,
            suburb=result.suburb,
            state=result.state,
            postcode=result.postcode,
            country=result.country,
            business_category=result.business_category,
            latitude=result.latitude,
            longitude=result.longitude,
            location_confidence=result.location_confidence,
            social_links="\n".join(result.social_links) or None,
            source_provider=search.provider,
            source_query=query_sent,
            source_external_id=result.source_external_id,
            dedup_key=dedup_key,
            duplicate_of_business_id=duplicate_of_business.id if duplicate_of_business else None,
            duplicate_of_discovered_business_id=duplicate_of_discovered.id if duplicate_of_discovered else None,
            status=DiscoveredBusinessStatus.NEW,
            instagram_handle=result.instagram_handle,
            instagram_profile_url=result.instagram_profile_url,
            instagram_profile_image_url=result.instagram_profile_image_url,
            instagram_bio=result.instagram_bio,
            instagram_follower_count=result.instagram_follower_count,
            instagram_last_post_at=result.instagram_last_post_at,
            instagram_bio_link_url=result.instagram_bio_link_url,
            instagram_website_status=result.instagram_website_status,
        )
        db.add(business)
        created.append(business)

    search.result_count += len(created)
    search.next_offset = offset + 1
    search.has_more = bool(page.has_more) and search.next_offset < MAX_PAGES_PER_SEARCH
    return created


def _enqueue_research(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, businesses: list[DiscoveredBusiness]) -> None:
    """Automation hand-off: research -> analysis -> scoring runs on its own
    from here — each stage's own service enqueues the next. Skipped for an
    exact duplicate of a business already discovered in this workspace
    (researched via its own row already); not skipped for a
    duplicate-of-CRM-business match (the discovery record still wants its
    own research/audit/score for the review queue)."""
    for business in businesses:
        if business.duplicate_of_discovered_business_id is not None:
            continue
        jobs_service.enqueue(
            db,
            workspace_id=workspace_id,
            job_type=JOB_BUSINESS_RESEARCH,
            payload={"discovered_business_id": str(business.id)},
            actor_id=actor_id,
        )


def create_and_run_search(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: DiscoverySearchCreate
) -> DiscoverySearchRead:
    if not any([data.location, data.industry, data.business_type, data.keywords]):
        raise InvalidSearchError(
            "A discovery search needs at least one of location, industry, business_type, or keywords"
        )

    provider_name = data.provider or registry.default_provider()
    provider = registry.get_provider(provider_name)  # raises UnknownProviderError if invalid

    search = DiscoverySearch(
        workspace_id=workspace_id,
        created_by_user_id=actor_id,
        query_label=data.query_label,
        location=data.location,
        industry=data.industry,
        business_type=data.business_type,
        keywords=data.keywords,
        min_score=data.min_score,
        max_score=data.max_score,
        has_website=data.has_website,
        website_outdated=data.website_outdated,
        provider=provider_name,
        status=DiscoverySearchStatus.RUNNING,
    )
    db.add(search)
    db.flush()

    try:
        page = provider.discover(_criteria_for(search, offset=0))
    except ProviderUnavailableError as exc:
        search.status = DiscoverySearchStatus.FAILED
        search.error_message = str(exc)
        search.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(search)
        return DiscoverySearchRead.model_validate(search)

    created = _ingest_page(db, workspace_id, actor_id, search, page, offset=0)

    search.status = DiscoverySearchStatus.COMPLETED
    search.completed_at = datetime.now(timezone.utc)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovery_search",
        entity_id=search.id,
        action="completed",
        summary=f"Discovery search ({provider_name}) found {len(created)} result(s)",
    )

    db.commit()
    db.refresh(search)
    _enqueue_research(db, workspace_id, actor_id, created)
    return DiscoverySearchRead.model_validate(search)


def load_more_search(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, search_id: uuid.UUID
) -> DiscoverySearchRead:
    """
    Pull the next provider page for an existing search, appending its new
    businesses to the same search (same stored criteria — filters are
    preserved for free). No-op-safe: raises NoMoreResultsError if the
    provider already said there's nothing further.
    """
    search = db.scalar(
        select(DiscoverySearch).where(
            DiscoverySearch.workspace_id == workspace_id, DiscoverySearch.id == search_id
        )
    )
    if search is None:
        raise SearchNotFoundError("Discovery search not found")
    if not search.has_more:
        raise NoMoreResultsError("No more results for this search")

    provider = registry.get_provider(search.provider)
    offset = search.next_offset

    try:
        page = provider.discover(_criteria_for(search, offset=offset))
    except ProviderUnavailableError as exc:
        # Leave the existing results intact; surface the failure without
        # flipping the whole search to FAILED (it already has results).
        search.error_message = str(exc)
        search.has_more = False
        db.commit()
        db.refresh(search)
        return DiscoverySearchRead.model_validate(search)

    created = _ingest_page(db, workspace_id, actor_id, search, page, offset=offset)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovery_search",
        entity_id=search.id,
        action="loaded_more",
        summary=f"Loaded {len(created)} more result(s) (page {offset + 1})",
    )

    db.commit()
    db.refresh(search)
    _enqueue_research(db, workspace_id, actor_id, created)
    return DiscoverySearchRead.model_validate(search)


INSTAGRAM_IMPORT_PROVIDER = "instagram_import"


def import_instagram_candidates(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: InstagramImportRequest
) -> InstagramImportResult:
    """
    Phase 1 of Instagram Discovery: turns operator-provided CSV text
    into a `DiscoverySearch` (provider="instagram_import") plus its
    `DiscoveredBusiness` rows, through the exact same `_ingest_page` path
    a live provider's page goes through — same dedup, same
    website-status normalization, same automatic research/audit/score
    hand-off (`_enqueue_research`). No live `discover()` call exists for
    this provider (see instagram_import.py's module docstring), so this
    bypasses the registry entirely rather than registering a fake
    `DiscoveryProvider` that would have to pretend to support pagination
    it doesn't have.
    """
    parsed = parse_instagram_csv(data.csv_text)
    if not parsed.results and not parsed.errors:
        raise InvalidSearchError("No rows found in the CSV — check it has a header row plus at least one data row")

    search = DiscoverySearch(
        workspace_id=workspace_id,
        created_by_user_id=actor_id,
        query_label=data.query_label or "Instagram import",
        provider=INSTAGRAM_IMPORT_PROVIDER,
        status=DiscoverySearchStatus.RUNNING,
    )
    db.add(search)
    db.flush()

    page = DiscoveryPage(results=parsed.results, has_more=False)
    created = _ingest_page(db, workspace_id, actor_id, search, page, offset=0)
    duplicate_count = len(parsed.results) - len(created)

    search.status = DiscoverySearchStatus.COMPLETED
    search.completed_at = datetime.now(timezone.utc)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovery_search",
        entity_id=search.id,
        action="completed",
        summary=f"Instagram import added {len(created)} candidate(s)"
        + (f", skipped {len(parsed.errors)} row(s)" if parsed.errors else ""),
    )

    db.commit()
    db.refresh(search)
    _enqueue_research(db, workspace_id, actor_id, created)

    return InstagramImportResult(
        search=DiscoverySearchRead.model_validate(search),
        created_count=len(created),
        duplicate_count=duplicate_count,
        skipped_rows=[InstagramImportRowError(row_number=e.row_number, reason=e.reason) for e in parsed.errors],
        truncated=parsed.truncated,
    )


def schedule_recurring_search(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    data: DiscoverySearchCreate,
    interval_hours: int = DEFAULT_DISCOVERY_INTERVAL_HOURS,
) -> Job:
    """
    Enqueues the "scheduled discovery" requirement (docs/04_ROADMAP.md M7)
    as a self-rescheduling job rather than running anything synchronously
    — the first run happens whenever a poller next claims it (immediately,
    if one is running), and `app/jobs/handlers.py::handle_discovery_search`
    re-enqueues itself `interval_hours` later each time it completes, per
    the design note on `Job.run_after`. Validates the same "at least one
    criterion" rule `create_and_run_search` does, so a bad schedule fails
    at creation time instead of quietly producing job after job that
    matches nothing.
    """
    if not any([data.location, data.industry, data.business_type, data.keywords]):
        raise InvalidSearchError(
            "A discovery search needs at least one of location, industry, business_type, or keywords"
        )
    if interval_hours < 1:
        raise InvalidSearchError("interval_hours must be at least 1")

    payload = {
        "query_label": data.query_label,
        "location": data.location,
        "industry": data.industry,
        "business_type": data.business_type,
        "keywords": data.keywords,
        "min_score": data.min_score,
        "max_score": data.max_score,
        "has_website": data.has_website,
        "website_outdated": data.website_outdated,
        "provider": data.provider,
        "recurring": True,
        "interval_hours": interval_hours,
    }
    return jobs_service.enqueue(
        db, workspace_id=workspace_id, job_type=JOB_DISCOVERY_SEARCH, payload=payload, actor_id=actor_id
    )


def list_scheduled_searches(db: Session, workspace_id: uuid.UUID) -> list[Job]:
    """Every not-yet-run recurring-discovery job — i.e. the next
    scheduled run of each recurring search, since `handle_discovery_search`
    replaces each one with its own successor rather than leaving
    completed rows around to filter out."""
    return [
        job
        for job in jobs_service.list_jobs(db, workspace_id, job_type=JOB_DISCOVERY_SEARCH)
        if job.payload.get("recurring") and job.status == JobStatus.PENDING
    ]


def list_discovery_searches(db: Session, workspace_id: uuid.UUID) -> list[DiscoverySearchRead]:
    query = select(DiscoverySearch).where(DiscoverySearch.workspace_id == workspace_id).order_by(
        DiscoverySearch.created_at.desc()
    )
    return [DiscoverySearchRead.model_validate(s) for s in db.scalars(query)]


def get_discovery_search(db: Session, workspace_id: uuid.UUID, search_id: uuid.UUID) -> DiscoverySearchRead | None:
    search = db.scalar(
        select(DiscoverySearch).where(DiscoverySearch.workspace_id == workspace_id, DiscoverySearch.id == search_id)
    )
    return DiscoverySearchRead.model_validate(search) if search else None


def _search_exists(db: Session, workspace_id: uuid.UUID, search_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(DiscoverySearch.id).where(
                DiscoverySearch.workspace_id == workspace_id, DiscoverySearch.id == search_id
            )
        )
        is not None
    )


def list_discovered_businesses(
    db: Session, workspace_id: uuid.UUID, search_id: uuid.UUID
) -> list[DiscoveredBusinessRead] | None:
    """Returns None (not an empty list) when the search itself doesn't exist/isn't in this
    workspace, so the route can 404 instead of silently returning an empty result set."""
    if not _search_exists(db, workspace_id, search_id):
        return None
    query = (
        select(DiscoveredBusiness)
        .where(DiscoveredBusiness.discovery_search_id == search_id)
        .order_by(DiscoveredBusiness.discovered_at.desc())
    )
    return [DiscoveredBusinessRead.model_validate(b) for b in db.scalars(query)]


def _get_discovered_business_orm(
    db: Session, workspace_id: uuid.UUID, business_id: uuid.UUID
) -> DiscoveredBusiness | None:
    return db.scalar(
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id == business_id)
    )


def get_discovered_business(
    db: Session, workspace_id: uuid.UUID, business_id: uuid.UUID
) -> DiscoveredBusinessRead | None:
    business = _get_discovered_business_orm(db, workspace_id, business_id)
    return DiscoveredBusinessRead.model_validate(business) if business else None


def _latest_quality_audit(db: Session, business_id: uuid.UUID) -> WebsiteQualityAudit | None:
    return db.scalar(
        select(WebsiteQualityAudit)
        .where(WebsiteQualityAudit.discovered_business_id == business_id)
        .order_by(WebsiteQualityAudit.audited_at.desc())
        .limit(1)
    )


def _latest_score(db: Session, business_id: uuid.UUID) -> OpportunityScoreResult | None:
    return db.scalar(
        select(OpportunityScoreResult)
        .where(OpportunityScoreResult.discovered_business_id == business_id)
        .order_by(OpportunityScoreResult.scored_at.desc())
        .limit(1)
    )


def list_review_items(
    db: Session, workspace_id: uuid.UUID, include_archived: bool = False
) -> list[DiscoveredBusinessReviewRead]:
    """
    The dedicated review interface's backing list — every discovered
    business across every search in the workspace, with the latest
    research/quality/score context folded in so the operator can decide
    approve/reject/archive/import without opening each one individually.
    """
    query = (
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id)
        .options(joinedload(DiscoveredBusiness.reviewed_by_user))
    )
    if not include_archived:
        query = query.where(DiscoveredBusiness.status != DiscoveredBusinessStatus.ARCHIVED)
    businesses = list(db.scalars(query.order_by(DiscoveredBusiness.discovered_at.desc())))

    items: list[DiscoveredBusinessReviewRead] = []
    for business in businesses:
        research = business_research_service.get_latest_research_result(db, business.id)
        quality_audit = _latest_quality_audit(db, business.id)
        score = _latest_score(db, business.id)
        key_problems = [f["message"] for f in (quality_audit.findings if quality_audit else [])][:3]

        items.append(
            DiscoveredBusinessReviewRead(
                id=business.id,
                name=business.name,
                industry=business.industry,
                business_category=business.business_category,
                suburb=business.suburb,
                state=business.state,
                website_url=business.website_url,
                website_status=business.website_status,
                status=business.status,
                source_provider=business.source_provider,
                discovered_at=business.discovered_at,
                imported_lead_id=business.imported_lead_id,
                instagram_handle=business.instagram_handle,
                instagram_website_status=business.instagram_website_status,
                reviewed_by_user_name=business.reviewed_by_user.name if business.reviewed_by_user else None,
                reviewed_at=business.reviewed_at,
                researched_at=research.researched_at if research else None,
                research_error=research.research_error if research else None,
                quality_summary=quality_audit.summary if quality_audit else None,
                key_problems=key_problems,
                opportunity_score=business.opportunity_score,
                score_category=business.score_category,
                confidence=score.confidence if score else None,
                recommended_sales_angle=score.recommendation_reason if score else None,
            )
        )
    return items


def _set_review_status(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    business_id: uuid.UUID,
    new_status: DiscoveredBusinessStatus,
    action: str,
    notes: str | None = None,
) -> DiscoveredBusinessRead | None:
    business = _get_discovered_business_orm(db, workspace_id, business_id)
    if business is None:
        return None
    if business.status in _REVIEW_ACTION_BLOCKED_STATUSES:
        raise InvalidReviewActionError(
            f"{business.name} was already imported into the CRM — review it there instead"
        )

    business.status = new_status
    business.reviewed_by_user_id = actor_id
    business.reviewed_at = datetime.now(timezone.utc)
    if notes is not None:
        business.review_notes = notes

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovered_business",
        entity_id=business.id,
        action=action,
        summary=f"{business.name}: {action}" + (f" — {notes}" if notes else ""),
    )
    db.commit()
    db.refresh(business)
    return DiscoveredBusinessRead.model_validate(business)


def approve_business(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, business_id: uuid.UUID
) -> ApproveResult | None:
    """
    Approving a discovered business brings it into the CRM in the same
    step — there is no separate "add to CRM" action. It's marked
    APPROVED and then imported (reusing `_import_discovered_business`),
    both in one transaction: if the import fails, the whole thing rolls
    back and the business stays reviewable rather than getting stuck
    "approved but not imported". If the business is already represented
    by a CRM lead, links to that lead instead of creating a duplicate.
    """
    business = _get_discovered_business_orm(db, workspace_id, business_id)
    if business is None:
        return None
    if business.status == DiscoveredBusinessStatus.IMPORTED:
        raise InvalidReviewActionError(
            f"{business.name} is already in the CRM — review it there instead"
        )

    business.status = DiscoveredBusinessStatus.APPROVED
    business.reviewed_by_user_id = actor_id
    business.reviewed_at = datetime.now(timezone.utc)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovered_business",
        entity_id=business.id,
        action="approved",
        summary=f"{business.name}: approved",
    )

    try:
        lead = _import_discovered_business(db, workspace_id, actor_id, business)
    except DuplicateLeadError:
        crm_business = _resolve_crm_business(db, workspace_id, business)
        existing_lead = crm_business.lead if crm_business is not None else None
        business.status = DiscoveredBusinessStatus.IMPORTED
        if existing_lead is not None:
            business.imported_lead_id = existing_lead.id
            business.duplicate_of_business_id = crm_business.id
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="discovered_business",
            entity_id=business.id,
            action="imported",
            summary=f"{business.name}: already in the CRM"
            + (f" as a lead for {crm_business.name}" if crm_business is not None else ""),
        )
        db.commit()
        db.refresh(business)
        return ApproveResult(
            business=DiscoveredBusinessRead.model_validate(business),
            outcome="already_in_crm",
            lead_id=existing_lead.id if existing_lead is not None else None,
        )

    db.commit()
    db.refresh(business)
    return ApproveResult(
        business=DiscoveredBusinessRead.model_validate(business),
        outcome="imported",
        lead_id=lead.id,
    )


def reject_business(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, business_id: uuid.UUID, notes: str | None = None
) -> DiscoveredBusinessRead | None:
    return _set_review_status(
        db, workspace_id, actor_id, business_id, DiscoveredBusinessStatus.REJECTED, "rejected", notes
    )


def archive_business(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, business_id: uuid.UUID
) -> DiscoveredBusinessRead | None:
    return _set_review_status(db, workspace_id, actor_id, business_id, DiscoveredBusinessStatus.ARCHIVED, "archived")


def bulk_approve(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, business_ids: list[uuid.UUID]
) -> BulkApproveResult:
    """Approve + add-to-CRM for each selected business. Each one is its
    own transaction (via `approve_business`), so one that can't be
    imported doesn't roll back the rest. Ids not in this workspace go to
    `not_found`; ones already imported are silently skipped (they're
    already done); a genuine import failure goes to `failed` with a
    reason and the business is left reviewable."""
    query = (
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id.in_(business_ids))
    )
    names = {b.id: b.name for b in db.scalars(query)}
    not_found = [bid for bid in business_ids if bid not in names]

    imported: list[DiscoveredBusinessRead] = []
    already_in_crm: list[DiscoveredBusinessRead] = []
    failed: list[BulkApproveFailure] = []

    for bid in business_ids:
        if bid not in names:
            continue
        try:
            result = approve_business(db, workspace_id, actor_id, bid)
        except InvalidReviewActionError:
            continue  # already imported — nothing to do
        except (CannotImportError, DuplicateLeadError, ValueError) as exc:
            db.rollback()
            failed.append(BulkApproveFailure(id=bid, name=names[bid], reason=str(exc)))
            continue
        if result is None:
            continue
        (imported if result.outcome == "imported" else already_in_crm).append(result.business)

    return BulkApproveResult(
        imported=imported, already_in_crm=already_in_crm, failed=failed, not_found=not_found
    )


def _split(text: str | None) -> str:
    return text.replace("\n", "; ") if text else ""


def _build_import_notes(
    business: DiscoveredBusiness,
    research,
    quality_audit: WebsiteQualityAudit | None,
    score: OpportunityScoreResult | None,
) -> str:
    """
    A plain-text digest of everything Lead Intelligence learned about
    this business, landed on the new Lead's own `notes` field — the
    "preserve all relevant research and scoring information" requirement.
    The real, queryable parts (score number, a WebsiteAudit row) are also
    preserved structurally by import_to_lead itself; this is the
    narrative record of *why*.
    """
    parts = [
        f"Imported from Lead Intelligence discovery (provider: {business.source_provider}"
        + (f", query: {business.source_query}" if business.source_query else "")
        + ")."
    ]
    if research is not None:
        parts.append(
            f"Research ({research.researched_at:%Y-%m-%d}): "
            f"confirmed — {_split(research.confirmed_facts) or 'none'}; "
            f"inferred — {_split(research.inferred_facts) or 'none'}; "
            f"unavailable — {_split(research.unavailable_fields) or 'none'}"
        )
    if quality_audit is not None:
        parts.append(f"Website quality audit: {quality_audit.summary}")
    if score is not None:
        parts.append(
            f"Opportunity score: {score.overall_score}/100 ({score.category.value.upper()}, "
            f"{score.confidence:.0%} confidence) — {score.recommendation_reason}"
        )
        if score.positive_signals:
            parts.append(f"Positive signals: {_split(score.positive_signals)}")
        if score.negative_signals:
            parts.append(f"Negative signals: {_split(score.negative_signals)}")
    return "\n\n".join(parts)


def _resolve_crm_business(
    db: Session, workspace_id: uuid.UUID, business: DiscoveredBusiness
) -> Business | None:
    """The CRM business this discovered row maps to, if any — the
    dedup-flagged one first, otherwise a fresh match against the
    workspace (re-checked at import time, not just at discovery time)."""
    if business.duplicate_of_business_id:
        crm_business = db.get(Business, business.duplicate_of_business_id)
        if crm_business is not None:
            return crm_business
    normalized = NormalizedBusinessResult(
        name=business.name,
        website_url=business.website_url,
        phone=business.phone,
        email=business.email,
        address=business.address,
        suburb=business.suburb,
        state=business.state,
        postcode=business.postcode,
    )
    return dedup.find_existing_business_match(db, workspace_id, normalized)


def _import_discovered_business(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, business: DiscoveredBusiness
) -> Lead:
    """
    Core import: create (or reuse) a CRM Business and a new Lead for this
    discovered business, preserving research/quality/score context onto
    the new Lead (score, priority derived from score category, a
    WebsiteAudit row from the latest research, and a full digest in
    notes — see _build_import_notes).

    Does **not** commit — the caller owns the transaction, so approval
    can import in the same transaction as the approval (and roll both
    back together on failure). Raises CannotImportError for a
    rejected/archived/already-imported row, and DuplicateLeadError when
    the matching CRM business already has a lead.
    """
    if business.status in _NOT_IMPORTABLE_STATUSES:
        raise CannotImportError(f"Cannot import a business with status {business.status.value}")

    crm_business = _resolve_crm_business(db, workspace_id, business)

    if crm_business is not None and crm_business.lead is not None:
        raise DuplicateLeadError(f"{crm_business.name} already has a lead in the CRM — not importing a duplicate")

    if crm_business is None:
        crm_business = Business(
            workspace_id=workspace_id,
            name=business.name,
            industry=business.industry,
            website_url=business.website_url,
            phone=business.phone,
            email=business.email,
            social_links=business.social_links,
            suburb=business.suburb,
            state=business.state,
            postcode=business.postcode,
        )
        db.add(crm_business)
        db.flush()

    research = business_research_service.get_latest_research_result(db, business.id)
    quality_audit = _latest_quality_audit(db, business.id)
    score = _latest_score(db, business.id)
    priority = _CATEGORY_TO_PRIORITY.get(business.score_category, LeadPriority.MEDIUM)

    lead = Lead(
        business_id=crm_business.id,
        source=f"discovery:{business.source_provider}",
        priority=priority,
        score=business.opportunity_score,
        notes=_build_import_notes(business, research, quality_audit, score),
    )
    db.add(lead)
    db.flush()

    if research is not None:
        db.add(
            WebsiteAudit(
                lead_id=lead.id,
                has_existing_site=research.website_reachable is not None,
                mobile_friendly=research.mobile_viewport_present,
                https=research.https,
                load_time_ms=research.load_time_ms,
                title=research.page_title,
                meta_description=research.meta_description,
                viewport_meta_present=research.mobile_viewport_present,
                audit_error=research.research_error,
                notes="Carried over from Lead Intelligence research.",
            )
        )

    business.status = DiscoveredBusinessStatus.IMPORTED
    business.imported_lead_id = lead.id
    business.duplicate_of_business_id = crm_business.id

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="created",
        summary=f"Imported from Lead Intelligence discovery: {business.name}",
    )
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovered_business",
        entity_id=business.id,
        action="imported",
        summary=f"Imported into CRM as a lead for {crm_business.name}",
    )

    return lead


def import_to_lead(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, business_id: uuid.UUID
) -> DiscoveredBusinessRead | None:
    """The standalone "add to CRM" action (the discovery results table's
    "Add lead" button, `POST /discovered-businesses/{id}/import`).
    Approving a business does the same thing in one step — see
    `approve_business` — this is the direct path for a row the operator
    doesn't need to formally review first."""
    business = _get_discovered_business_orm(db, workspace_id, business_id)
    if business is None:
        return None
    _import_discovered_business(db, workspace_id, actor_id, business)
    db.commit()
    db.refresh(business)
    return DiscoveredBusinessRead.model_validate(business)
