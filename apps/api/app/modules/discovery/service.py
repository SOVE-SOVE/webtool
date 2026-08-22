import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.integrations.discovery import registry
from app.integrations.discovery.base import DiscoveryCriteria, ProviderUnavailableError
from app.modules.activity_log import service as activity_service
from app.modules.discovery import dedup
from app.modules.discovery.models import (
    DiscoveredBusiness,
    DiscoveredBusinessStatus,
    DiscoverySearch,
    DiscoverySearchStatus,
)
from app.modules.discovery.schemas import DiscoveredBusinessRead, DiscoverySearchCreate, DiscoverySearchRead

MAX_RESULTS_PER_SEARCH = 20


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


def get_discovered_business(
    db: Session, workspace_id: uuid.UUID, business_id: uuid.UUID
) -> DiscoveredBusinessRead | None:
    business = db.scalar(
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id == business_id)
    )
    return DiscoveredBusinessRead.model_validate(business) if business else None
