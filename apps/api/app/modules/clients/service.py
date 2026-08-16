import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.clients.schemas import ClientCreate, ClientRead, ClientUpdate
from app.modules.leads.models import Lead, LeadStatus
from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity
from app.modules.users.service import require_user_in_workspace


def _to_read(client: Client) -> ClientRead:
    return ClientRead(
        id=client.id,
        business_id=client.business_id,
        business_name=client.business.name,
        billing_email=client.billing_email,
        contract_signed_at=client.contract_signed_at,
        assigned_user_id=client.assigned_user_id,
        assigned_user_name=client.assigned_user.name if client.assigned_user else None,
        project_count=len(client.projects),
        created_at=client.created_at,
    )


def _load(db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID) -> Client | None:
    # Only the business is joined here — joining the projects collection
    # too would require `.unique()` on every fetch, including this
    # single-row one; client.projects lazy-loads fine for a single get.
    return db.scalar(
        select(Client)
        .join(Business, Client.business_id == Business.id)
        .where(Client.id == client_id, Business.workspace_id == workspace_id)
        .options(joinedload(Client.business), joinedload(Client.assigned_user))
    )


def list_clients(db: Session, workspace_id: uuid.UUID) -> list[ClientRead]:
    clients = db.scalars(
        select(Client)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(
            joinedload(Client.business), joinedload(Client.assigned_user), joinedload(Client.projects)
        )
        .order_by(Client.created_at.desc())
    ).unique()
    return [_to_read(c) for c in clients]


def get_client(db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID) -> ClientRead | None:
    client = _load(db, workspace_id, client_id)
    return _to_read(client) if client else None


def create_client(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: ClientCreate
) -> ClientRead:
    if data.from_lead_id is not None:
        lead = db.scalar(
            select(Lead)
            .join(Business, Lead.business_id == Business.id)
            .where(Lead.id == data.from_lead_id, Business.workspace_id == workspace_id)
            .options(joinedload(Lead.business))
        )
        if lead is None:
            raise HTTPException(status_code=404, detail="Lead not found")
        business = lead.business
        lead.status = LeadStatus.WON
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
            workspace_id=workspace_id,
            name=data.business_name,
            industry=data.industry,
            website_url=data.website_url,
            phone=data.phone,
            suburb=data.suburb,
            state=data.state,
        )
        db.add(business)
        db.flush()

    if data.assigned_user_id is not None:
        require_user_in_workspace(db, workspace_id, data.assigned_user_id)

    client = Client(
        business_id=business.id, billing_email=data.billing_email, assigned_user_id=data.assigned_user_id
    )
    db.add(client)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="client",
        entity_id=client.id,
        action="created",
        summary=f"Added client {business.name}",
    )

    db.commit()
    db.refresh(client)
    client.business = business
    client.projects = []
    return _to_read(client)


def update_client(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, client_id: uuid.UUID, data: ClientUpdate
) -> ClientRead | None:
    client = _load(db, workspace_id, client_id)
    if client is None:
        return None

    if "assigned_user_id" in data.model_fields_set and data.assigned_user_id != client.assigned_user_id:
        if data.assigned_user_id is not None:
            require_user_in_workspace(db, workspace_id, data.assigned_user_id)
        client.assigned_user_id = data.assigned_user_id
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="client",
            entity_id=client.id,
            action="assigned",
            summary="Unassigned" if data.assigned_user_id is None else "Reassigned",
        )

    db.commit()
    db.refresh(client)
    return _to_read(client)
