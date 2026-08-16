import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.businesses.models import Business
from app.modules.businesses.schemas import BusinessCreate


def list_businesses(db: Session, workspace_id: uuid.UUID) -> list[Business]:
    return list(
        db.scalars(
            select(Business)
            .where(Business.workspace_id == workspace_id)
            .order_by(Business.created_at.desc())
        )
    )


def get_business(db: Session, workspace_id: uuid.UUID, business_id: uuid.UUID) -> Business | None:
    return db.scalar(
        select(Business).where(Business.id == business_id, Business.workspace_id == workspace_id)
    )


def create_business(db: Session, workspace_id: uuid.UUID, data: BusinessCreate) -> Business:
    business = Business(workspace_id=workspace_id, **data.model_dump())
    db.add(business)
    db.commit()
    db.refresh(business)
    return business
