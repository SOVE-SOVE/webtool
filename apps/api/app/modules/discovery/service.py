import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.discovery.schemas import DiscoveredBusinessRead, DiscoverySearchRead


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
