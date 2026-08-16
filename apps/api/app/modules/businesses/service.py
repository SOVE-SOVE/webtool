import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.businesses.models import Business
from app.modules.businesses.schemas import BusinessCreate


def list_businesses(db: Session) -> list[Business]:
    return list(db.scalars(select(Business).order_by(Business.created_at.desc())))


def get_business(db: Session, business_id: uuid.UUID) -> Business | None:
    return db.get(Business, business_id)


def create_business(db: Session, data: BusinessCreate) -> Business:
    business = Business(**data.model_dump())
    db.add(business)
    db.commit()
    db.refresh(business)
    return business
