import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.businesses import service
from app.modules.businesses.schemas import BusinessCreate, BusinessRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/businesses", tags=["businesses"])


@router.get("", response_model=list[BusinessRead])
def list_businesses(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[BusinessRead]:
    return list(service.list_businesses(db, current_user.workspace_id))


@router.post("", response_model=BusinessRead, status_code=201)
def create_business(
    data: BusinessCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> BusinessRead:
    return service.create_business(db, current_user.workspace_id, data)


@router.get("/{business_id}", response_model=BusinessRead)
def get_business(
    business_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BusinessRead:
    business = service.get_business(db, current_user.workspace_id, business_id)
    if business is None:
        raise HTTPException(status_code=404, detail="Business not found")
    return business
