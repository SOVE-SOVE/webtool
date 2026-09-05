import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.discovery.models import DiscoveredBusiness
from app.modules.leads.models import Lead, LeadPriority, LeadStatus
from app.modules.leads.schemas import LeadCreate, LeadRead, LeadUpdate
from app.modules.pipeline import service as pipeline_service
from app.modules.review_intelligence import service as review_intelligence_service
from app.modules.users.service import require_user_in_workspace


def _to_read(db: Session, lead: Lead) -> LeadRead:
    """
    Review intelligence fields are a read-only projection onto the Lead
    — never recomputed or duplicated here. A Lead imported from Lead
    Intelligence discovery always has exactly one originating
    DiscoveredBusiness (`imported_lead_id` is set at most once, see
    modules/discovery/service.py::_import_discovered_business); this
    looks that row back up and reads its latest ReviewIntelligenceResult
    straight off it. A lead created directly in the CRM (no discovery
    origin) simply has no review data to show.
    """
    discovered_business = db.scalar(
        select(DiscoveredBusiness.id).where(DiscoveredBusiness.imported_lead_id == lead.id)
    )
    review_summary = (
        review_intelligence_service.get_review_summary(db, discovered_business) if discovered_business else None
    )

    return LeadRead(
        id=lead.id,
        business_id=lead.business_id,
        business_name=lead.business.name,
        industry=lead.business.industry,
        suburb=lead.business.suburb,
        state=lead.business.state,
        website_url=lead.business.website_url,
        business_email=lead.business.email,
        business_phone=lead.business.phone,
        status=lead.status,
        priority=lead.priority,
        score=lead.score,
        source=lead.source,
        notes=lead.notes,
        archived_at=lead.archived_at,
        assigned_user_id=lead.assigned_user_id,
        assigned_user_name=lead.assigned_user.name if lead.assigned_user else None,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
        google_rating=review_summary.google_rating if review_summary else None,
        google_review_count=review_summary.google_review_count if review_summary else None,
        review_health_score=review_summary.review_health_score if review_summary else None,
        review_activity_level=review_summary.review_activity_level if review_summary else None,
        review_frequency_per_month=review_summary.review_frequency_per_month if review_summary else None,
        review_sentiment_trend=review_summary.review_sentiment_trend if review_summary else None,
        positive_review_themes=review_summary.positive_review_themes if review_summary else [],
        negative_review_themes=review_summary.negative_review_themes if review_summary else [],
        review_summary=review_summary.review_summary if review_summary else None,
        review_data_updated_at=review_summary.review_data_updated_at if review_summary else None,
    )


def _base_query(workspace_id: uuid.UUID):
    return (
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(joinedload(Lead.business), joinedload(Lead.assigned_user))
    )


def list_leads(db: Session, workspace_id: uuid.UUID, include_archived: bool = False) -> list[LeadRead]:
    query = _base_query(workspace_id)
    if not include_archived:
        query = query.where(Lead.archived_at.is_(None))
    leads = db.scalars(query.order_by(Lead.created_at.desc()))
    return [_to_read(db, lead) for lead in leads]


def get_lead(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> LeadRead | None:
    lead = db.scalar(_base_query(workspace_id).where(Lead.id == lead_id))
    return _to_read(db, lead) if lead else None


def create_lead(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: LeadCreate
) -> LeadRead:
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
    db.flush()  # assigns business.id without ending the transaction

    if data.assigned_user_id is not None:
        require_user_in_workspace(db, workspace_id, data.assigned_user_id)

    lead = Lead(
        business_id=business.id,
        source=data.source,
        priority=data.priority if data.priority is not None else LeadPriority.MEDIUM,
        assigned_user_id=data.assigned_user_id,
    )
    db.add(lead)
    db.flush()  # assigns lead.id for the activity log row below

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="created",
        summary=f"Created lead for {business.name}",
    )

    db.commit()
    db.refresh(lead)
    lead.business = business
    return _to_read(db, lead)


def update_lead(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    lead_id: uuid.UUID,
    data: LeadUpdate,
) -> LeadRead | None:
    lead = db.scalar(_base_query(workspace_id).where(Lead.id == lead_id))
    if lead is None:
        return None

    if data.status is not None and data.status != lead.status:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="lead",
            entity_id=lead.id,
            action="status_changed",
            summary=f"{lead.status.value} -> {data.status.value}",
        )
        pipeline_service.record_lead_event(
            db, lead_id=lead.id, kind="status_changed", summary=f"{lead.status.value} -> {data.status.value}"
        )
        lead.status = data.status

    if data.priority is not None:
        lead.priority = data.priority

    if data.score is not None:
        lead.score = data.score

    if "notes" in data.model_fields_set:
        lead.notes = data.notes

    # assigned_user_id is only touched when the client sent the key at
    # all — `null` unassigns, an omitted key leaves assignment as-is.
    if "assigned_user_id" in data.model_fields_set and data.assigned_user_id != lead.assigned_user_id:
        if data.assigned_user_id is not None:
            require_user_in_workspace(db, workspace_id, data.assigned_user_id)
        lead.assigned_user_id = data.assigned_user_id
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="lead",
            entity_id=lead.id,
            action="assigned",
            summary="Unassigned" if data.assigned_user_id is None else "Reassigned",
        )

    db.commit()
    db.refresh(lead)
    return _to_read(db, lead)


def archive_lead(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, lead_id: uuid.UUID
) -> LeadRead | None:
    lead = db.scalar(_base_query(workspace_id).where(Lead.id == lead_id))
    if lead is None:
        return None
    if lead.archived_at is None:
        lead.archived_at = datetime.now(timezone.utc)
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="lead",
            entity_id=lead.id,
            action="archived",
        )
        db.commit()
        db.refresh(lead)
    return _to_read(db, lead)


def mark_researched(db: Session, *, workspace_id: uuid.UUID, actor_id: uuid.UUID | None, lead: Lead) -> None:
    """
    The first website audit / sales audit generated for a lead is the
    "research done" event — bumps status forward only from NEW, same
    "only forward, never regress a further-along lead" contract as
    meetings/service.py's `_PRE_MEETING_STATUSES` bump to MEETING. A
    lead already RESEARCHED or further along (qualified, contacted,
    won, ...) isn't touched by re-running research.
    """
    if lead.status != LeadStatus.NEW:
        return
    previous = lead.status
    lead.status = LeadStatus.RESEARCHED
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="status_changed",
        summary=f"{previous.value} -> {lead.status.value} (research generated)",
    )
    pipeline_service.record_lead_event(
        db, lead_id=lead.id, kind="status_changed", summary=f"{previous.value} -> {lead.status.value}"
    )


# Sending outreach / receiving a reply only bumps a lead forward from a
# status genuinely *behind* the new one — never regresses a lead that's
# already at meeting/proposal/won/lost, and never drags a NURTURE lead
# (a deliberate parking state, not a pipeline position) back into the
# active funnel. Same contract as `mark_researched` above and
# meetings/service.py's `_PRE_MEETING_STATUSES`.
_PRE_CONTACTED_STATUSES = (LeadStatus.NEW, LeadStatus.RESEARCHED, LeadStatus.QUALIFIED)
_PRE_REPLIED_STATUSES = (*_PRE_CONTACTED_STATUSES, LeadStatus.CONTACTED)
_PRE_PROPOSAL_STATUSES = (*_PRE_REPLIED_STATUSES, LeadStatus.REPLIED, LeadStatus.MEETING)


def _advance_status(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    lead: Lead,
    new_status: LeadStatus,
    allowed_from: tuple[LeadStatus, ...],
    reason: str,
) -> None:
    if lead.status not in allowed_from:
        return
    previous = lead.status
    lead.status = new_status
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="status_changed",
        summary=f"{previous.value} -> {new_status.value} ({reason})",
    )
    pipeline_service.record_lead_event(
        db, lead_id=lead.id, kind="status_changed", summary=f"{previous.value} -> {new_status.value}"
    )


def mark_contacted(db: Session, *, workspace_id: uuid.UUID, actor_id: uuid.UUID | None, lead: Lead) -> None:
    """Marking outreach as sent is the "we've made contact" event — the
    operator already did the sending, so the status shouldn't also have
    to be flipped by hand afterwards."""
    _advance_status(
        db,
        workspace_id=workspace_id,
        actor_id=actor_id,
        lead=lead,
        new_status=LeadStatus.CONTACTED,
        allowed_from=_PRE_CONTACTED_STATUSES,
        reason="outreach sent",
    )


def mark_replied(db: Session, *, workspace_id: uuid.UUID, actor_id: uuid.UUID | None, lead: Lead) -> None:
    """Recording a reply to outreach is the "they responded" event."""
    _advance_status(
        db,
        workspace_id=workspace_id,
        actor_id=actor_id,
        lead=lead,
        new_status=LeadStatus.REPLIED,
        allowed_from=_PRE_REPLIED_STATUSES,
        reason="reply received",
    )


def mark_proposal_sent(db: Session, *, workspace_id: uuid.UUID, actor_id: uuid.UUID | None, lead: Lead) -> None:
    """Logging a proposal/quote (see modules/sales_opportunities/service.py)
    is the "we've made an offer" event."""
    _advance_status(
        db,
        workspace_id=workspace_id,
        actor_id=actor_id,
        lead=lead,
        new_status=LeadStatus.PROPOSAL,
        allowed_from=_PRE_PROPOSAL_STATUSES,
        reason="proposal sent",
    )


def mark_lost(db: Session, *, workspace_id: uuid.UUID, actor_id: uuid.UUID | None, lead: Lead) -> None:
    """A lost opportunity (see modules/sales_opportunities/service.py's
    mark_opportunity_lost) closes the lead out too — unlike the forward-
    only bumps above, this is a direct set: LOST is a terminal state
    reachable from anywhere in the active funnel, not just the status
    immediately behind it. Never overwrites an already-WON lead — a
    stale/superseded quote being marked lost after the deal closed some
    other way shouldn't reopen the question."""
    if lead.status in (LeadStatus.WON, LeadStatus.LOST):
        return
    previous = lead.status
    lead.status = LeadStatus.LOST
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="status_changed",
        summary=f"{previous.value} -> {lead.status.value} (opportunity marked lost)",
    )
    pipeline_service.record_lead_event(
        db, lead_id=lead.id, kind="status_changed", summary=f"{previous.value} -> {lead.status.value}"
    )


def unarchive_lead(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, lead_id: uuid.UUID
) -> LeadRead | None:
    lead = db.scalar(_base_query(workspace_id).where(Lead.id == lead_id))
    if lead is None:
        return None
    if lead.archived_at is not None:
        lead.archived_at = None
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="lead",
            entity_id=lead.id,
            action="unarchived",
        )
        db.commit()
        db.refresh(lead)
    return _to_read(db, lead)
