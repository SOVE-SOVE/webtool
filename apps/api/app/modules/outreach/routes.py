import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.leads import service as leads_service
from app.modules.outreach import service
from app.modules.outreach.schemas import FollowUpBuckets, FollowUpRead, OutreachGenerateRequest, OutreachMessageRead
from app.modules.users.models import User

router = APIRouter(tags=["outreach"])


@router.post("/api/v1/leads/{lead_id}/outreach", response_model=OutreachMessageRead, status_code=201)
def generate_outreach(
    lead_id: uuid.UUID,
    body: OutreachGenerateRequest,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> OutreachMessageRead:
    message = service.generate_outreach(db, current_user.workspace_id, current_user.id, lead_id, body.channel)
    if message is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return message


@router.get("/api/v1/leads/{lead_id}/outreach", response_model=list[OutreachMessageRead])
def list_outreach(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OutreachMessageRead]:
    if leads_service.get_lead(db, current_user.workspace_id, lead_id) is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return service.list_outreach(db, current_user.workspace_id, lead_id)


@router.get("/api/v1/outreach/{message_id}", response_model=OutreachMessageRead)
def get_outreach(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OutreachMessageRead:
    message = service.get_outreach(db, current_user.workspace_id, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Outreach message not found")
    return message


@router.post("/api/v1/outreach/{message_id}/approve", response_model=OutreachMessageRead)
def approve_outreach(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OutreachMessageRead:
    message = service.approve_outreach(db, current_user.workspace_id, current_user.id, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Outreach message not found")
    return message


@router.post("/api/v1/outreach/{message_id}/mark-sent", response_model=OutreachMessageRead)
def mark_outreach_sent(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OutreachMessageRead:
    message = service.mark_outreach_sent(db, current_user.workspace_id, current_user.id, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Outreach message not found")
    return message


@router.post("/api/v1/outreach/{message_id}/mark-replied", response_model=OutreachMessageRead)
def mark_outreach_replied(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OutreachMessageRead:
    message = service.mark_outreach_replied(db, current_user.workspace_id, current_user.id, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Outreach message not found")
    return message


@router.post("/api/v1/outreach/{message_id}/close", response_model=OutreachMessageRead)
def close_outreach(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OutreachMessageRead:
    message = service.close_outreach(db, current_user.workspace_id, current_user.id, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Outreach message not found")
    return message


@router.post("/api/v1/leads/{lead_id}/follow-ups", response_model=FollowUpRead, status_code=201)
def generate_follow_up(
    lead_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> FollowUpRead:
    follow_up = service.generate_follow_up(db, current_user.workspace_id, current_user.id, lead_id)
    if follow_up is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return follow_up


@router.get("/api/v1/follow-ups", response_model=FollowUpBuckets)
def list_follow_ups(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FollowUpBuckets:
    return service.list_follow_ups(db, current_user.workspace_id)


@router.post("/api/v1/follow-ups/{follow_up_id}/resolve", response_model=FollowUpRead)
def resolve_follow_up(
    follow_up_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FollowUpRead:
    follow_up = service.resolve_follow_up(db, current_user.workspace_id, current_user.id, follow_up_id)
    if follow_up is None:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return follow_up
