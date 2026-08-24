import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents import follow_up as follow_up_agent
from app.agents import outreach as outreach_agent
from app.agents.follow_up import FollowUpInput
from app.agents.follow_up import PriorOutreachSummary as FollowUpPriorOutreachSummary
from app.agents.outreach import OutreachInput
from app.agents.outreach import PriorOutreachSummary as OutreachPriorOutreachSummary
from app.agents.sales_audit import SalesAuditOutput
from app.agents.website_audit import WebsiteAuditOutput
from app.core.settings import settings
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.contacts.models import Contact
from app.modules.interactions.models import Interaction, InteractionKind
from app.modules.leads import service as leads_service
from app.modules.leads.models import Lead
from app.modules.outreach.models import FollowUp, FollowUpStatus, OutreachChannel, OutreachMessage, OutreachStatus
from app.modules.outreach.schemas import FollowUpBuckets, FollowUpRead, OutreachMessageRead, OutreachMessageUpdate
from app.modules.sales_audits.models import SalesAuditReport
from app.modules.website_audits.models import WebsiteAudit


def _split(text: str | None) -> list[str]:
    if not text:
        return []
    return [line.strip() for line in text.splitlines() if line.strip()]


def _get_lead_with_business(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
    return db.scalar(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Lead.id == lead_id)
        .options(joinedload(Lead.business))
    )


def _get_outreach_message(db: Session, workspace_id: uuid.UUID, message_id: uuid.UUID) -> OutreachMessage | None:
    return db.scalar(
        select(OutreachMessage)
        .join(Lead, OutreachMessage.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, OutreachMessage.id == message_id)
        .options(
            joinedload(OutreachMessage.generated_by_user),
            joinedload(OutreachMessage.approved_by_user),
            joinedload(OutreachMessage.sent_by_user),
            joinedload(OutreachMessage.closed_by_user),
        )
    )


def _primary_contact_name(db: Session, business_id: uuid.UUID) -> str | None:
    contact = db.scalar(select(Contact).where(Contact.business_id == business_id).order_by(Contact.created_at).limit(1))
    return contact.name if contact else None


def _to_website_audit_output(audit: WebsiteAudit | None) -> WebsiteAuditOutput | None:
    if audit is None:
        return None
    return WebsiteAuditOutput(
        has_existing_site=audit.has_existing_site,
        mobile_friendly=audit.mobile_friendly,
        https=audit.https,
        load_time_ms=audit.load_time_ms,
        title=audit.title,
        meta_description=audit.meta_description,
        viewport_meta_present=audit.viewport_meta_present,
        audit_error=audit.audit_error,
    )


def _to_sales_audit_output(report: SalesAuditReport | None) -> SalesAuditOutput | None:
    if report is None:
        return None
    return SalesAuditOutput(
        business_summary=report.business_summary,
        website_strengths=_split(report.website_strengths),
        top_problems=_split(report.top_problems),
        why_problems_matter=_split(report.why_problems_matter),
        recommended_improvements=_split(report.recommended_improvements),
        suggested_structure=_split(report.suggested_structure),
        talking_points=_split(report.talking_points),
        potential_objections=_split(report.potential_objections),
        suggested_offer=report.suggested_offer,
    )


def _history_excerpt(m: OutreachMessage) -> str:
    if m.channel in (OutreachChannel.EMAIL, OutreachChannel.FOLLOW_UP):
        return f"Subject: {m.subject!r}. Body: {m.body}"
    points = ", ".join(_split(m.key_points))
    return f"Opening: {m.opening_line!r}. Key points: {points}"


def _lead_outreach_history(db: Session, lead_id: uuid.UUID) -> list[OutreachMessage]:
    return list(
        db.scalars(select(OutreachMessage).where(OutreachMessage.lead_id == lead_id).order_by(OutreachMessage.generated_at))
    )


def generate_outreach(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, lead_id: uuid.UUID, channel: OutreachChannel
) -> OutreachMessageRead | None:
    lead = _get_lead_with_business(db, workspace_id, lead_id)
    if lead is None:
        return None
    business = lead.business

    history = _lead_outreach_history(db, lead.id)
    if channel == OutreachChannel.FOLLOW_UP and not history:
        # A follow-up message that references contact which never happened
        # would be exactly the fabricated-relationship invention this
        # feature must never produce — refuse structurally rather than
        # trust the prompt alone.
        raise HTTPException(
            status_code=400,
            detail="Cannot draft a follow-up message — no prior outreach exists for this lead yet.",
        )

    latest_website_audit = db.scalar(
        select(WebsiteAudit).where(WebsiteAudit.lead_id == lead.id).order_by(WebsiteAudit.audited_at.desc()).limit(1)
    )
    latest_sales_audit = db.scalar(
        select(SalesAuditReport)
        .where(SalesAuditReport.lead_id == lead.id)
        .order_by(SalesAuditReport.generated_at.desc())
        .limit(1)
    )

    result = outreach_agent.run(
        OutreachInput(
            channel=channel.value,
            business_name=business.name,
            industry=business.industry,
            suburb=business.suburb,
            state=business.state,
            website_url=business.website_url,
            contact_name=_primary_contact_name(db, business.id),
            business_notes=business.notes,
            lead_status=lead.status.value,
            lead_score=lead.score,
            website_audit=_to_website_audit_output(latest_website_audit),
            sales_audit=_to_sales_audit_output(latest_sales_audit),
            prior_outreach=[
                OutreachPriorOutreachSummary(
                    channel=m.channel.value,
                    status=m.status.value,
                    generated_at=m.generated_at.isoformat(),
                    excerpt=_history_excerpt(m),
                )
                for m in history
            ],
        )
    )
    output = result.output

    message = OutreachMessage(
        lead_id=lead.id,
        based_on_sales_audit_id=latest_sales_audit.id if latest_sales_audit else None,
        channel=channel,
        status=OutreachStatus.DRAFTED,
        flagged_for_review=result.flagged_for_review,
        review_notes=result.notes,
        model_used=settings.llm_model,
        prompt_version=outreach_agent.PROMPT_VERSION,
        generated_by_user_id=actor_id,
    )
    if channel in (OutreachChannel.EMAIL, OutreachChannel.FOLLOW_UP):
        message.subject = output.subject
        message.body = output.body
    else:
        message.opening_line = output.opening_line
        message.key_points = "\n".join(output.key_points)
        message.objection_handling = "\n".join(output.objection_handling)
        message.suggested_close = output.suggested_close

    db.add(message)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="outreach_drafted",
        summary=f"Drafted {channel.value} outreach for {business.name}",
    )

    db.commit()
    db.refresh(message)
    return OutreachMessageRead.from_model(message, result.flagged_for_review, result.notes)


def list_outreach(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> list[OutreachMessageRead]:
    query = (
        select(OutreachMessage)
        .join(Lead, OutreachMessage.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, OutreachMessage.lead_id == lead_id)
        .options(
            joinedload(OutreachMessage.generated_by_user),
            joinedload(OutreachMessage.approved_by_user),
            joinedload(OutreachMessage.sent_by_user),
            joinedload(OutreachMessage.closed_by_user),
        )
        .order_by(OutreachMessage.generated_at.desc())
    )
    messages = db.scalars(query)
    return [OutreachMessageRead.from_model(m, m.flagged_for_review, m.review_notes) for m in messages]


def get_outreach(db: Session, workspace_id: uuid.UUID, message_id: uuid.UUID) -> OutreachMessageRead | None:
    message = _get_outreach_message(db, workspace_id, message_id)
    if message is None:
        return None
    return OutreachMessageRead.from_model(message, message.flagged_for_review, message.review_notes)


def update_outreach(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, message_id: uuid.UUID, update: OutreachMessageUpdate
) -> OutreachMessageRead | None:
    """
    Operator edit before sending. Refused once the message has actually
    gone out (SENT/REPLIED/FOLLOW_UP_DUE/CLOSED) — editing the row past
    that point would misrepresent what was really sent, the same reason
    every other checkpoint in this app reverts approval instead of
    allowing silent drift after the fact. Editing an APPROVED draft
    reverts it to DRAFTED, same "content changed, approval no longer
    covers it" contract used across the rest of this codebase (brief,
    creative direction, sitemap, website sections).
    """
    message = _get_outreach_message(db, workspace_id, message_id)
    if message is None:
        return None
    if message.status not in (OutreachStatus.DRAFTED, OutreachStatus.APPROVED):
        raise HTTPException(status_code=400, detail=f"Cannot edit outreach in status {message.status.value}")

    fields = update.model_dump(exclude_unset=True)
    if "subject" in fields:
        message.subject = fields["subject"]
    if "body" in fields:
        message.body = fields["body"]
    if "opening_line" in fields:
        message.opening_line = fields["opening_line"]
    if "key_points" in fields:
        message.key_points = "\n".join(fields["key_points"]) if fields["key_points"] else None
    if "objection_handling" in fields:
        message.objection_handling = "\n".join(fields["objection_handling"]) if fields["objection_handling"] else None
    if "suggested_close" in fields:
        message.suggested_close = fields["suggested_close"]

    reverted = message.status == OutreachStatus.APPROVED
    if reverted:
        message.status = OutreachStatus.DRAFTED
        message.approved_by_user_id = None
        message.approved_at = None

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=message.lead_id,
        action="outreach_edited",
        summary=f"Edited {message.channel.value} outreach" + (" — approval reverted to draft" if reverted else ""),
    )
    db.commit()
    db.refresh(message)
    return OutreachMessageRead.from_model(message, message.flagged_for_review, message.review_notes)


def approve_outreach(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, message_id: uuid.UUID
) -> OutreachMessageRead | None:
    message = _get_outreach_message(db, workspace_id, message_id)
    if message is None:
        return None
    if message.status != OutreachStatus.DRAFTED:
        raise HTTPException(status_code=400, detail=f"Cannot approve outreach in status {message.status.value}")

    message.status = OutreachStatus.APPROVED
    message.approved_by_user_id = actor_id
    message.approved_at = datetime.now(timezone.utc)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=message.lead_id,
        action="outreach_approved",
        summary=f"Approved {message.channel.value} outreach",
    )
    db.commit()
    db.refresh(message)
    return OutreachMessageRead.from_model(message, message.flagged_for_review, message.review_notes)


def mark_outreach_sent(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, message_id: uuid.UUID
) -> OutreachMessageRead | None:
    message = _get_outreach_message(db, workspace_id, message_id)
    if message is None:
        return None
    if message.status not in (OutreachStatus.DRAFTED, OutreachStatus.APPROVED):
        raise HTTPException(status_code=400, detail=f"Cannot mark outreach in status {message.status.value} as sent")

    message.status = OutreachStatus.SENT
    message.sent_by_user_id = actor_id
    message.sent_at = datetime.now(timezone.utc)

    db.add(
        Interaction(
            lead_id=message.lead_id,
            kind=InteractionKind.OUTREACH_SENT,
            summary=f"{message.channel.value} outreach sent",
        )
    )
    leads_service.mark_contacted(db, workspace_id=workspace_id, actor_id=actor_id, lead=message.lead)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=message.lead_id,
        action="outreach_sent",
        summary=f"Marked {message.channel.value} outreach as sent",
    )
    db.commit()
    db.refresh(message)
    return OutreachMessageRead.from_model(message, message.flagged_for_review, message.review_notes)


def mark_outreach_replied(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, message_id: uuid.UUID
) -> OutreachMessageRead | None:
    message = _get_outreach_message(db, workspace_id, message_id)
    if message is None:
        return None
    if message.status not in (OutreachStatus.SENT, OutreachStatus.FOLLOW_UP_DUE):
        raise HTTPException(status_code=400, detail=f"Cannot mark outreach in status {message.status.value} as replied")

    message.status = OutreachStatus.REPLIED
    message.replied_at = datetime.now(timezone.utc)

    db.add(
        Interaction(
            lead_id=message.lead_id,
            kind=InteractionKind.REPLY,
            summary=f"Reply received to {message.channel.value} outreach",
        )
    )
    leads_service.mark_replied(db, workspace_id=workspace_id, actor_id=actor_id, lead=message.lead)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=message.lead_id,
        action="outreach_replied",
        summary=f"Marked {message.channel.value} outreach as replied",
    )
    db.commit()
    db.refresh(message)
    return OutreachMessageRead.from_model(message, message.flagged_for_review, message.review_notes)


def close_outreach(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, message_id: uuid.UUID
) -> OutreachMessageRead | None:
    message = _get_outreach_message(db, workspace_id, message_id)
    if message is None:
        return None
    if message.status == OutreachStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Outreach is already closed")

    message.status = OutreachStatus.CLOSED
    message.closed_by_user_id = actor_id
    message.closed_at = datetime.now(timezone.utc)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=message.lead_id,
        action="outreach_closed",
        summary=f"Closed {message.channel.value} outreach",
    )
    db.commit()
    db.refresh(message)
    return OutreachMessageRead.from_model(message, message.flagged_for_review, message.review_notes)


def generate_follow_up(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, lead_id: uuid.UUID
) -> FollowUpRead | None:
    lead = _get_lead_with_business(db, workspace_id, lead_id)
    if lead is None:
        return None
    business = lead.business

    history = _lead_outreach_history(db, lead.id)
    most_recent = history[-1] if history else None

    result = follow_up_agent.run(
        FollowUpInput(
            business_name=business.name,
            industry=business.industry,
            suburb=business.suburb,
            state=business.state,
            lead_status=lead.status.value,
            lead_score=lead.score,
            prior_outreach=[
                FollowUpPriorOutreachSummary(
                    channel=m.channel.value,
                    status=m.status.value,
                    generated_at=m.generated_at.isoformat(),
                    excerpt=_history_excerpt(m),
                )
                for m in history
            ],
        )
    )
    output = result.output

    follow_up = FollowUp(
        lead_id=lead.id,
        outreach_message_id=most_recent.id if most_recent else None,
        channel=OutreachChannel(output.channel),
        due_date=output.due_date,
        suggested_next_action=output.suggested_next_action,
        status=FollowUpStatus.PENDING,
        flagged_for_review=result.flagged_for_review,
        review_notes=result.notes,
        model_used=settings.llm_model,
        prompt_version=follow_up_agent.PROMPT_VERSION,
        generated_by_user_id=actor_id,
    )
    db.add(follow_up)

    if most_recent is not None and most_recent.status in (OutreachStatus.SENT, OutreachStatus.REPLIED):
        most_recent.status = OutreachStatus.FOLLOW_UP_DUE

    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="follow_up_generated",
        summary=f"Follow-up suggested via {output.channel} on {output.due_date.isoformat()}",
    )

    db.commit()
    db.refresh(follow_up)
    return FollowUpRead.from_model(follow_up)


def list_follow_ups(db: Session, workspace_id: uuid.UUID) -> FollowUpBuckets:
    query = (
        select(FollowUp)
        .join(Lead, FollowUp.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, FollowUp.status == FollowUpStatus.PENDING)
        .options(
            joinedload(FollowUp.lead).joinedload(Lead.business),
            joinedload(FollowUp.outreach_message),
            joinedload(FollowUp.generated_by_user),
            joinedload(FollowUp.resolved_by_user),
        )
        .order_by(FollowUp.due_date)
    )
    follow_ups = db.scalars(query).unique()

    today = date.today()
    overdue: list[FollowUpRead] = []
    due_today: list[FollowUpRead] = []
    upcoming: list[FollowUpRead] = []
    for f in follow_ups:
        read = FollowUpRead.from_model(f)
        if f.due_date < today:
            overdue.append(read)
        elif f.due_date == today:
            due_today.append(read)
        else:
            upcoming.append(read)
    return FollowUpBuckets(overdue=overdue, due_today=due_today, upcoming=upcoming)


def resolve_follow_up(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, follow_up_id: uuid.UUID
) -> FollowUpRead | None:
    follow_up = db.scalar(
        select(FollowUp)
        .join(Lead, FollowUp.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, FollowUp.id == follow_up_id)
        .options(joinedload(FollowUp.lead).joinedload(Lead.business), joinedload(FollowUp.outreach_message))
    )
    if follow_up is None:
        return None
    if follow_up.status == FollowUpStatus.DONE:
        raise HTTPException(status_code=400, detail="Follow-up is already done")

    follow_up.status = FollowUpStatus.DONE
    follow_up.resolved_by_user_id = actor_id
    follow_up.resolved_at = datetime.now(timezone.utc)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=follow_up.lead_id,
        action="follow_up_completed",
        summary="Follow-up marked done",
    )
    db.commit()
    db.refresh(follow_up)
    return FollowUpRead.from_model(follow_up)
