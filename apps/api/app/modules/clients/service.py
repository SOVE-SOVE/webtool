import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.clients.schemas import ClientCreate, ClientRead
from app.modules.leads.models import Lead, LeadStage
from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity


def _to_read(client: Client) -> ClientRead:
    return ClientRead(
        id=client.id,
        business_id=client.business_id,
        business_name=client.business.name,
        billing_email=client.billing_email,
        contract_signed_at=client.contract_signed_at,
        project_count=len(client.projects),
        created_at=client.created_at,
    )


def _load(db: Session, client_id: uuid.UUID) -> Client | None:
    # Only the business is joined here — joining the projects collection
    # too would require `.unique()` on every fetch, including this
    # single-row one; client.projects lazy-loads fine for a single get.
    return db.scalar(select(Client).options(joinedload(Client.business)).where(Client.id == client_id))


def list_clients(db: Session) -> list[ClientRead]:
    clients = db.scalars(
        select(Client)
        .options(joinedload(Client.business), joinedload(Client.projects))
        .order_by(Client.created_at.desc())
    ).unique()
    return [_to_read(c) for c in clients]


def get_client(db: Session, client_id: uuid.UUID) -> ClientRead | None:
    client = _load(db, client_id)
    return _to_read(client) if client else None


def create_client(db: Session, data: ClientCreate) -> ClientRead:
    if data.from_lead_id is not None:
        lead = db.scalar(
            select(Lead).options(joinedload(Lead.business)).where(Lead.id == data.from_lead_id)
        )
        if lead is None:
            raise HTTPException(status_code=404, detail="Lead not found")
        business = lead.business
        lead.stage = LeadStage.WON
        # Converting a lead is the "deal closed" event — record it as a
        # won opportunity so it counts toward the dashboard's won-projects
        # and revenue metrics, whether or not a price was captured.
        db.add(
            SalesOpportunity(
                lead_id=lead.id,
                status=OpportunityStatus.WON,
                proposed_price_cents=data.won_price_cents,
            )
        )
    else:
        business = Business(
            name=data.business_name,
            industry=data.industry,
            website_url=data.website_url,
            phone=data.phone,
            suburb=data.suburb,
            state=data.state,
        )
        db.add(business)
        db.flush()

    client = Client(business_id=business.id, billing_email=data.billing_email)
    db.add(client)
    db.commit()
    db.refresh(client)
    client.business = business
    client.projects = []
    return _to_read(client)
