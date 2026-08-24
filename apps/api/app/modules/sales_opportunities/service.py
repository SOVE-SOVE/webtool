import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.leads import service as leads_service
from app.modules.leads.models import Lead
from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity
from app.modules.sales_opportunities.schemas import SalesOpportunityCreate, SalesOpportunityRead


def _to_read(opportunity: SalesOpportunity) -> SalesOpportunityRead:
    return SalesOpportunityRead(
        id=opportunity.id,
        lead_id=opportunity.lead_id,
        business_name=opportunity.lead.business.name,
        tier=opportunity.tier,
        proposed_price_cents=opportunity.proposed_price_cents,
        status=opportunity.status,
        created_at=opportunity.created_at,
        updated_at=opportunity.updated_at,
        closed_at=opportunity.closed_at,
    )


def _get_lead(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
    return db.scalar(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Lead.id == lead_id)
        .options(joinedload(Lead.business))
    )


def _get_opportunity(db: Session, workspace_id: uuid.UUID, opportunity_id: uuid.UUID) -> SalesOpportunity | None:
    return db.scalar(
        select(SalesOpportunity)
        .join(Lead, SalesOpportunity.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, SalesOpportunity.id == opportunity_id)
        .options(joinedload(SalesOpportunity.lead).joinedload(Lead.business))
    )


def create_opportunity(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    lead_id: uuid.UUID,
    data: SalesOpportunityCreate,
) -> SalesOpportunityRead | None:
    """Logs a real proposal/quote against a lead — the only source of the
    sales dashboard's estimated-revenue figure (see
    modules/sales_dashboard/service.py). Also advances the lead to
    PROPOSAL, same "the operator's real action moves the pipeline"
    contract as outreach send/reply (modules/outreach/service.py)."""
    lead = _get_lead(db, workspace_id, lead_id)
    if lead is None:
        return None

    opportunity = SalesOpportunity(
        lead_id=lead.id,
        tier=data.tier,
        proposed_price_cents=data.proposed_price_cents,
        status=OpportunityStatus.OPEN,
    )
    db.add(opportunity)
    db.flush()

    leads_service.mark_proposal_sent(db, workspace_id=workspace_id, actor_id=actor_id, lead=lead)

    price_note = (
        f"${data.proposed_price_cents / 100:,.0f}" if data.proposed_price_cents is not None else "no price on file"
    )
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="proposal_logged",
        summary=f"Logged a proposal ({price_note})",
    )

    db.commit()
    db.refresh(opportunity)
    opportunity.lead = lead
    return _to_read(opportunity)


def list_for_lead(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> list[SalesOpportunityRead] | None:
    lead = _get_lead(db, workspace_id, lead_id)
    if lead is None:
        return None
    opportunities = db.scalars(
        select(SalesOpportunity)
        .where(SalesOpportunity.lead_id == lead_id)
        .options(joinedload(SalesOpportunity.lead).joinedload(Lead.business))
        .order_by(SalesOpportunity.created_at.desc())
    )
    return [_to_read(o) for o in opportunities]


def mark_opportunity_lost(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, opportunity_id: uuid.UUID
) -> SalesOpportunityRead | None:
    opportunity = _get_opportunity(db, workspace_id, opportunity_id)
    if opportunity is None:
        return None
    if opportunity.status != OpportunityStatus.OPEN:
        raise HTTPException(status_code=400, detail=f"Cannot mark an opportunity in status {opportunity.status.value} as lost")

    opportunity.status = OpportunityStatus.LOST
    opportunity.closed_at = datetime.now(timezone.utc)

    leads_service.mark_lost(db, workspace_id=workspace_id, actor_id=actor_id, lead=opportunity.lead)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=opportunity.lead_id,
        action="proposal_lost",
        summary="Marked the proposal as lost",
    )

    db.commit()
    db.refresh(opportunity)
    return _to_read(opportunity)
