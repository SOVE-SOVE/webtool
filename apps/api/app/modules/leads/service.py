import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.businesses.models import Business
from app.modules.leads.models import Lead
from app.modules.leads.schemas import LeadCreate, LeadRead, LeadUpdate


def _to_read(lead: Lead) -> LeadRead:
    return LeadRead(
        id=lead.id,
        business_id=lead.business_id,
        business_name=lead.business.name,
        industry=lead.business.industry,
        suburb=lead.business.suburb,
        state=lead.business.state,
        stage=lead.stage,
        score=lead.score,
        source=lead.source,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


def list_leads(db: Session) -> list[LeadRead]:
    leads = db.scalars(
        select(Lead).options(joinedload(Lead.business)).order_by(Lead.created_at.desc())
    )
    return [_to_read(lead) for lead in leads]


def get_lead(db: Session, lead_id: uuid.UUID) -> LeadRead | None:
    lead = db.scalar(select(Lead).options(joinedload(Lead.business)).where(Lead.id == lead_id))
    return _to_read(lead) if lead else None


def create_lead(db: Session, data: LeadCreate) -> LeadRead:
    business = Business(
        name=data.business_name,
        industry=data.industry,
        website_url=data.website_url,
        phone=data.phone,
        suburb=data.suburb,
        state=data.state,
    )
    db.add(business)
    db.flush()  # assigns business.id without ending the transaction

    lead = Lead(business_id=business.id, source=data.source)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    lead.business = business
    return _to_read(lead)


def update_lead(db: Session, lead_id: uuid.UUID, data: LeadUpdate) -> LeadRead | None:
    lead = db.scalar(select(Lead).options(joinedload(Lead.business)).where(Lead.id == lead_id))
    if lead is None:
        return None
    if data.stage is not None:
        lead.stage = data.stage
    if data.score is not None:
        lead.score = data.score
    db.commit()
    db.refresh(lead)
    return _to_read(lead)
