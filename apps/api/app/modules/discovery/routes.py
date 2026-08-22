import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.discovery import service
from app.modules.discovery.schemas import DiscoveredBusinessRead, DiscoverySearchRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/discovery-searches", tags=["discovery"])


@router.get("", response_model=list[DiscoverySearchRead])
def list_discovery_searches(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DiscoverySearchRead]:
    return service.list_discovery_searches(db, current_user.workspace_id)


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


@discovered_businesses_router.get("/{business_id}", response_model=DiscoveredBusinessRead)
def get_discovered_business(
    business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DiscoveredBusinessRead:
    business = service.get_discovered_business(db, current_user.workspace_id, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Discovered business not found")
    return business
