import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.integrations.discovery import registry
from app.integrations.discovery.base import DiscoveryCriteria, NormalizedBusinessResult, ProviderUnavailableError
from app.modules.activity_log import service as activity_service
from app.modules.business_research import service as business_research_service
from app.modules.business_research.models import BusinessResearchResult
from app.modules.businesses.models import Business
from app.modules.discovery import dedup
from app.modules.discovery.models import (
    DiscoveredBusiness,
    DiscoveredBusinessStatus,
    DiscoverySearch,
    DiscoverySearchStatus,
    OpportunityScoreCategory,
)
from app.modules.discovery.schemas import (
    BulkApproveResult,
    DiscoveredBusinessRead,
    DiscoveredBusinessReviewRead,
    DiscoverySearchCreate,
    DiscoverySearchRead,
)
from app.modules.leads.models import Lead, LeadPriority
from app.modules.opportunity_scoring.models import OpportunityScoreResult
from app.modules.website_audits.models import WebsiteAudit
from app.modules.website_quality.models import WebsiteQualityAudit

MAX_RESULTS_PER_SEARCH = 20

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


def create_and_run_search(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: DiscoverySearchCreate
) -> DiscoverySearchRead:
    if not any([data.location, data.industry, data.business_type, data.keywords]):
        raise InvalidSearchError(
            "A discovery search needs at least one of location, industry, business_type, or keywords"
        )

    provider_name = data.provider or registry.DEFAULT_PROVIDER
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

    criteria = DiscoveryCriteria(
        location=data.location,
        industry=data.industry,
        business_type=data.business_type,
        keywords=data.keywords,
        limit=MAX_RESULTS_PER_SEARCH,
    )

    try:
        raw_results = provider.discover(criteria)
    except ProviderUnavailableError as exc:
        search.status = DiscoverySearchStatus.FAILED
        search.error_message = str(exc)
        search.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(search)
        return DiscoverySearchRead.model_validate(search)

    if data.has_website is not None:
        raw_results = [r for r in raw_results if bool(r.website_url) == data.has_website]

    query_sent = " ".join(p for p in (data.industry, data.business_type, data.keywords, data.location) if p)

    for result in raw_results:
        dedup_key = dedup.compute_dedup_key(result.name, result.suburb, result.state)
        duplicate_of_business = dedup.find_existing_business_match(db, workspace_id, result)
        duplicate_of_discovered = (
            None
            if duplicate_of_business is not None
            else dedup.find_duplicate_discovered_business(db, workspace_id, result, dedup_key)
        )

        db.add(
            DiscoveredBusiness(
                discovery_search_id=search.id,
                name=result.name,
                industry=result.industry,
                website_url=result.website_url,
                phone=result.phone,
                email=result.email,
                address=result.address,
                suburb=result.suburb,
                state=result.state,
                postcode=result.postcode,
                social_links="\n".join(result.social_links) or None,
                source_provider=provider_name,
                source_query=query_sent,
                source_external_id=result.source_external_id,
                dedup_key=dedup_key,
                duplicate_of_business_id=duplicate_of_business.id if duplicate_of_business else None,
                duplicate_of_discovered_business_id=duplicate_of_discovered.id if duplicate_of_discovered else None,
                status=DiscoveredBusinessStatus.NEW,
            )
        )

    search.status = DiscoverySearchStatus.COMPLETED
    search.result_count = len(raw_results)
    search.completed_at = datetime.now(timezone.utc)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovery_search",
        entity_id=search.id,
        action="completed",
        summary=f"Discovery search ({provider_name}) found {len(raw_results)} result(s)",
    )

    db.commit()
    db.refresh(search)
    return DiscoverySearchRead.model_validate(search)


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


def _latest_per(db: Session, model, group_column, order_column, keys: list[uuid.UUID]) -> dict:
    """
    One row per group — the newest. Postgres DISTINCT ON, so this stays a
    single query for every business on the page instead of one per-row
    lookup each — same pattern as modules/dashboard/service.py's helper
    of the same name.
    """
    if not keys:
        return {}
    rows = db.scalars(
        select(model).where(group_column.in_(keys)).distinct(group_column).order_by(group_column, order_column.desc())
    ).unique()
    return {getattr(row, group_column.key): row for row in rows}


def list_review_items(
    db: Session, workspace_id: uuid.UUID, include_archived: bool = False, limit: int = 100
) -> list[DiscoveredBusinessReviewRead]:
    """
    The dedicated review interface's backing list — every discovered
    business across every search in the workspace, with the latest
    research/quality/score context folded in so the operator can decide
    approve/reject/archive/import without opening each one individually.
    Defaults to the newest 100 (same "cap an unbounded, ever-growing
    list" precedent as modules/activity_log/service.py's list_activity)
    since this spans every search ever run in the workspace, not one
    search's results.

    Every business's latest research/quality/score is fetched as 3
    batched DISTINCT ON queries (`_latest_per`) rather than 3 queries per
    business — this list spans every search ever run in the workspace,
    so a per-row lookup would scale with the workspace's total discovery
    history, not the page size.
    """
    query = (
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id)
        .options(joinedload(DiscoveredBusiness.reviewed_by_user))
    )
    if not include_archived:
        query = query.where(DiscoveredBusiness.status != DiscoveredBusinessStatus.ARCHIVED)
    businesses = list(db.scalars(query.order_by(DiscoveredBusiness.discovered_at.desc()).limit(limit)))

    business_ids = [b.id for b in businesses]
    researches = _latest_per(
        db, BusinessResearchResult, BusinessResearchResult.discovered_business_id, BusinessResearchResult.researched_at, business_ids
    )
    quality_audits = _latest_per(
        db, WebsiteQualityAudit, WebsiteQualityAudit.discovered_business_id, WebsiteQualityAudit.audited_at, business_ids
    )
    scores = _latest_per(
        db, OpportunityScoreResult, OpportunityScoreResult.discovered_business_id, OpportunityScoreResult.scored_at, business_ids
    )

    items: list[DiscoveredBusinessReviewRead] = []
    for business in businesses:
        research = researches.get(business.id)
        quality_audit = quality_audits.get(business.id)
        score = scores.get(business.id)
        key_problems = [f["message"] for f in (quality_audit.findings if quality_audit else [])][:3]

        items.append(
            DiscoveredBusinessReviewRead(
                id=business.id,
                name=business.name,
                industry=business.industry,
                suburb=business.suburb,
                state=business.state,
                website_url=business.website_url,
                status=business.status,
                source_provider=business.source_provider,
                discovered_at=business.discovered_at,
                imported_lead_id=business.imported_lead_id,
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
) -> DiscoveredBusinessRead | None:
    return _set_review_status(db, workspace_id, actor_id, business_id, DiscoveredBusinessStatus.APPROVED, "approved")


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
    """Silently skips ids that don't exist in this workspace or are already
    IMPORTED, rather than failing the whole batch — a bulk action over a
    mixed selection should apply to what it can."""
    query = (
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id.in_(business_ids))
    )
    found = list(db.scalars(query))
    approvable = [b for b in found if b.status not in _REVIEW_ACTION_BLOCKED_STATUSES]
    found_ids = {b.id for b in approvable}
    not_found = [business_id for business_id in business_ids if business_id not in found_ids]

    now = datetime.now(timezone.utc)
    for business in approvable:
        business.status = DiscoveredBusinessStatus.APPROVED
        business.reviewed_by_user_id = actor_id
        business.reviewed_at = now
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="discovered_business",
            entity_id=business.id,
            action="approved",
            summary=f"{business.name}: approved (bulk)",
        )

    db.commit()
    for business in approvable:
        db.refresh(business)
    return BulkApproveResult(
        approved=[DiscoveredBusinessRead.model_validate(b) for b in approvable], not_found=not_found
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


def import_to_lead(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, business_id: uuid.UUID
) -> DiscoveredBusinessRead | None:
    """
    Creates (or reuses) a CRM Business and a new Lead for this
    discovered business, preserving research/quality/score context onto
    the new Lead (score, priority derived from score category, a
    WebsiteAudit row from the latest research, and a full digest in
    notes — see _build_import_notes). Re-checks for a duplicate CRM
    business at import time (not just the dedup flag set at discovery
    time) and refuses to create a second lead for a business that
    already has one — see DuplicateLeadError.
    """
    business = _get_discovered_business_orm(db, workspace_id, business_id)
    if business is None:
        return None
    if business.status in _NOT_IMPORTABLE_STATUSES:
        raise CannotImportError(f"Cannot import a business with status {business.status.value}")

    crm_business = None
    if business.duplicate_of_business_id:
        crm_business = db.get(Business, business.duplicate_of_business_id)
    if crm_business is None:
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
        crm_business = dedup.find_existing_business_match(db, workspace_id, normalized)

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

    db.commit()
    db.refresh(business)
    return DiscoveredBusinessRead.model_validate(business)
