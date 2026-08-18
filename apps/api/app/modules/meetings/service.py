import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, aliased, joinedload

from app.agents import meeting_brief as meeting_brief_agent
from app.core.logging import logger
from app.core.settings import settings
from app.integrations import google_calendar
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.interactions.models import Interaction
from app.modules.leads.models import Lead, LeadStatus
from app.modules.meetings.models import Meeting, MeetingBrief, MeetingStatus, MeetingType
from app.modules.meetings.schemas import MeetingBriefRead, MeetingCreate, MeetingRead, MeetingUpdate
from app.modules.outreach.models import OutreachMessage
from app.modules.projects.models import Project
from app.modules.sales_audits.models import SalesAuditReport
from app.modules.users.service import require_user_in_workspace

# The three real price tiers this business sells at — see
# docs/00_VISION.md "Offer" and agents/prompts/sales_audit.md, which is
# the only place a tier name is ever chosen. Matched against a Sales
# Audit's free-text suggested_offer to pull a fixed, real price into
# the brief deterministically — never re-guessed or re-priced here.
_PRICE_TIERS: list[tuple[str, str]] = [
    ("simple", "Simple (~$599)"),
    ("core", "Core (~$899)"),
    ("advanced", "Advanced (~$1,299+)"),
]

# Meetings belong to exactly one of project or lead, and each reaches the
# workspace via a different FK chain, so both paths are joined (outer,
# since only one side is ever populated) and matched with OR — same
# pattern as app/modules/tasks/service.py.
_ProjectBusiness = aliased(Business)
_LeadBusiness = aliased(Business)

# A meeting only bumps a lead's status forward, never regresses one
# that's already further along (already had a meeting, in proposal, or
# closed either way) — booking a second meeting shouldn't undo progress.
_PRE_MEETING_STATUSES = (
    LeadStatus.NEW,
    LeadStatus.RESEARCHED,
    LeadStatus.QUALIFIED,
    LeadStatus.CONTACTED,
    LeadStatus.REPLIED,
)


def _context(meeting: Meeting) -> str:
    if meeting.project is not None:
        return f"Project: {meeting.project.name}"
    return f"Lead: {meeting.lead.business.name}"


def _to_read(meeting: Meeting) -> MeetingRead:
    return MeetingRead(
        id=meeting.id,
        title=meeting.title,
        meeting_type=meeting.meeting_type,
        status=meeting.status,
        scheduled_at=meeting.scheduled_at,
        duration_minutes=meeting.duration_minutes,
        held_at=meeting.held_at,
        notes=meeting.notes,
        outcome=meeting.outcome,
        project_id=meeting.project_id,
        lead_id=meeting.lead_id,
        assigned_user_id=meeting.assigned_user_id,
        assigned_user_name=meeting.assigned_user.name if meeting.assigned_user else None,
        synced_to_calendar=meeting.external_event_id is not None,
        context=_context(meeting),
        created_at=meeting.created_at,
        brief=MeetingBriefRead.from_model(meeting.brief) if meeting.brief else None,
    )


def _base_query(workspace_id: uuid.UUID):
    return (
        select(Meeting)
        .outerjoin(Project, Meeting.project_id == Project.id)
        .outerjoin(Client, Project.client_id == Client.id)
        .outerjoin(_ProjectBusiness, Client.business_id == _ProjectBusiness.id)
        .outerjoin(Lead, Meeting.lead_id == Lead.id)
        .outerjoin(_LeadBusiness, Lead.business_id == _LeadBusiness.id)
        .where(
            or_(
                _ProjectBusiness.workspace_id == workspace_id,
                _LeadBusiness.workspace_id == workspace_id,
            )
        )
        .options(
            joinedload(Meeting.project),
            joinedload(Meeting.lead).joinedload(Lead.business),
            joinedload(Meeting.assigned_user),
            joinedload(Meeting.brief),
        )
    )


def list_meetings(db: Session, workspace_id: uuid.UUID) -> list[MeetingRead]:
    meetings = db.scalars(_base_query(workspace_id).order_by(Meeting.scheduled_at.asc()))
    return [_to_read(m) for m in meetings]


def get_meeting(db: Session, workspace_id: uuid.UUID, meeting_id: uuid.UUID) -> MeetingRead | None:
    meeting = db.scalar(_base_query(workspace_id).where(Meeting.id == meeting_id))
    return _to_read(meeting) if meeting else None


def _get_project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Project.id == project_id, Business.workspace_id == workspace_id)
    )


def _get_lead_in_workspace(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
    return db.scalar(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(Lead.id == lead_id, Business.workspace_id == workspace_id)
        .options(joinedload(Lead.business))
    )


def _calendar_description(meeting: Meeting) -> str:
    lines = [_context(meeting), f"Type: {meeting.meeting_type.value.replace('_', ' ')}"]
    if meeting.notes:
        lines.append(f"Notes: {meeting.notes}")
    lines.append("Booked via Web Design OS.")
    return "\n".join(lines)


def _sync_to_google_calendar(
    db: Session, meeting: Meeting, previous_assigned_user_id: uuid.UUID | None = None
) -> None:
    """
    Best-effort, non-fatal by design (see docs/05_DECISIONS.md): silently
    does nothing if the assigned user has no connected calendar, an
    expired/revoked token, or Google is unreachable — a meeting is still
    booked in this app regardless of whether the calendar push succeeds.
    Never sets attendees or sends an invite email — see
    integrations/google_calendar.py's module docstring.
    """
    # Imported here, not at module scope, to avoid a circular import —
    # modules/calendar/service.py imports this module for its calendar
    # aggregation view. See modules/calendar/connections.py's docstring.
    from app.modules.calendar import connections as calendar_connections

    if previous_assigned_user_id and previous_assigned_user_id != meeting.assigned_user_id and meeting.external_event_id:
        _delete_google_event(db, previous_assigned_user_id, meeting.external_event_id)
        meeting.external_event_id = None

    if meeting.assigned_user_id is None:
        return

    access_token = calendar_connections.get_valid_access_token(db, meeting.assigned_user_id)
    if access_token is None:
        return

    calendar_id = calendar_connections.get_connection_calendar_id(db, meeting.assigned_user_id)
    event = google_calendar.MeetingEvent(
        title=meeting.title,
        description=_calendar_description(meeting),
        start=meeting.scheduled_at,
        duration_minutes=meeting.duration_minutes,
    )
    if meeting.external_event_id:
        google_calendar.update_event(access_token, calendar_id, meeting.external_event_id, event)
    else:
        external_id = google_calendar.create_event(access_token, calendar_id, event)
        if external_id:
            meeting.external_event_id = external_id


def _remove_from_google_calendar(db: Session, meeting: Meeting) -> None:
    if meeting.assigned_user_id is None or meeting.external_event_id is None:
        return
    _delete_google_event(db, meeting.assigned_user_id, meeting.external_event_id)
    meeting.external_event_id = None


def _delete_google_event(db: Session, user_id: uuid.UUID, event_id: str) -> None:
    from app.modules.calendar import connections as calendar_connections

    access_token = calendar_connections.get_valid_access_token(db, user_id)
    if access_token is None:
        return
    calendar_id = calendar_connections.get_connection_calendar_id(db, user_id)
    google_calendar.delete_event(access_token, calendar_id, event_id)


def _business_location(business: Business) -> str | None:
    parts = [p for p in (business.suburb, business.state) if p]
    return ", ".join(parts) if parts else None


def _offer_from_audit(suggested_offer: str | None) -> tuple[str, str]:
    """
    Matches a Sales Audit's free-text suggested_offer against the three
    real tier names to pull a fixed, real price — the only prices this
    business actually quotes (see _PRICE_TIERS). Never guesses a new
    number.
    """
    if not suggested_offer:
        return (
            "No sales audit generated yet — no package suggestion available.",
            "Not available — generate a sales audit first.",
        )
    lowered = suggested_offer.lower()
    for keyword, price in _PRICE_TIERS:
        if keyword in lowered:
            return (suggested_offer, price)
    return (suggested_offer, "Tier not clearly identified from the sales audit text — see package note.")


def _gather_brief_facts(db: Session, lead: Lead, meeting: Meeting) -> dict:
    """
    Assembles the BUSINESS/WEBSITE/SALES facts and the package/pricing
    note directly from stored records — no LLM involvement, so nothing
    returned here can be invented. See MeetingBrief's docstring.
    """
    business = lead.business

    latest_audit = db.scalar(
        select(SalesAuditReport)
        .where(SalesAuditReport.lead_id == lead.id)
        .order_by(SalesAuditReport.generated_at.desc())
    )
    if latest_audit is not None:
        website_strengths = [s for s in latest_audit.website_strengths.split("\n") if s]
        website_weaknesses = [s for s in latest_audit.top_problems.split("\n") if s]
        website_opportunities = [s for s in latest_audit.recommended_improvements.split("\n") if s]
        objections = [s for s in latest_audit.potential_objections.split("\n") if s]
        possible_package, suggested_pricing_range = _offer_from_audit(latest_audit.suggested_offer)
    else:
        website_strengths, website_weaknesses, website_opportunities, objections = [], [], [], []
        possible_package, suggested_pricing_range = _offer_from_audit(None)

    interaction_rows = db.scalars(
        select(Interaction)
        .where(Interaction.lead_id == lead.id)
        .order_by(Interaction.occurred_at.desc())
        .limit(10)
    )
    prior_interactions = [
        meeting_brief_agent.PriorInteractionSummary(
            kind=i.kind.value, occurred_at=i.occurred_at.isoformat(), summary=i.summary
        )
        for i in interaction_rows
    ]

    outreach_rows = db.scalars(
        select(OutreachMessage)
        .where(OutreachMessage.lead_id == lead.id)
        .order_by(OutreachMessage.generated_at.desc())
        .limit(10)
    )
    prior_outreach = [
        meeting_brief_agent.PriorOutreachSummary(
            channel=m.channel.value,
            status=m.status.value,
            generated_at=m.generated_at.isoformat(),
            excerpt=(m.body or m.opening_line or m.key_points or "")[:200],
        )
        for m in outreach_rows
    ]

    return {
        "business_name": business.name,
        "business_industry": business.industry,
        "business_location": _business_location(business),
        "business_website": business.website_url,
        "website_strengths": website_strengths,
        "website_weaknesses": website_weaknesses,
        "website_opportunities": website_opportunities,
        "lead_score": lead.score,
        "previous_interactions": [
            f"[{i.occurred_at}] {i.kind}" + (f" — {i.summary}" if i.summary else "") for i in prior_interactions
        ],
        "outreach_history": [
            f"[{o.generated_at}] {o.channel} ({o.status}): {o.excerpt}" for o in prior_outreach
        ],
        "objections": objections,
        "possible_package": possible_package,
        "suggested_pricing_range": suggested_pricing_range,
        "prior_interactions": prior_interactions,
        "prior_outreach": prior_outreach,
    }


def _generate_brief(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, meeting: Meeting, lead: Lead) -> None:
    """
    BUSINESS/WEBSITE/SALES facts and the package/pricing note are always
    assembled (pure DB reads, see _gather_brief_facts) — those sections
    never depend on the LLM being configured. Only questions_to_ask and
    likely_requirements come from agents/meeting_brief.py, and degrade
    gracefully (empty, flagged for review) rather than skipping the
    whole brief, if no LLM key is configured or generation fails —
    matching integrations/search.py's "skip rather than fake" pattern
    for the part that's actually generated, without losing the parts
    that aren't.
    """
    facts = _gather_brief_facts(db, lead, meeting)

    questions_to_ask: list[str] = []
    likely_requirements: list[str] = []
    flagged_for_review = True
    review_notes = (
        "No LLM configured — discovery questions/requirements unavailable. "
        "Business/website/sales facts below are accurate and unaffected."
    )
    model_used = "none"

    if settings.llm_api_key:
        try:
            discovery_input = meeting_brief_agent.MeetingBriefDiscoveryInput(
                business_name=facts["business_name"],
                industry=facts["business_industry"],
                lead_status=lead.status.value,
                lead_priority=lead.priority.value,
                lead_score=lead.score,
                lead_notes=lead.notes,
                meeting_title=meeting.title,
                meeting_type=meeting.meeting_type.value,
                scheduled_at=meeting.scheduled_at.isoformat(),
                website_strengths=facts["website_strengths"],
                website_weaknesses=facts["website_weaknesses"],
                website_opportunities=facts["website_opportunities"],
                objections=facts["objections"],
                possible_package=facts["possible_package"],
                prior_outreach=facts["prior_outreach"],
                prior_interactions=facts["prior_interactions"],
            )
            result = meeting_brief_agent.run(discovery_input)
            questions_to_ask = result.output.questions_to_ask
            likely_requirements = result.output.likely_requirements
            flagged_for_review = result.flagged_for_review
            review_notes = result.notes
            model_used = settings.llm_model
        except Exception as exc:  # noqa: BLE001 - genuinely must never break booking, see docstring
            logger.warning("Meeting brief discovery generation failed for meeting %s: %s", meeting.id, exc)
            flagged_for_review = True
            review_notes = "Discovery question generation failed — business/website/sales facts below are unaffected."

    brief = MeetingBrief(
        meeting_id=meeting.id,
        business_name=facts["business_name"],
        business_industry=facts["business_industry"],
        business_location=facts["business_location"],
        business_website=facts["business_website"],
        website_strengths="\n".join(facts["website_strengths"]),
        website_weaknesses="\n".join(facts["website_weaknesses"]),
        website_opportunities="\n".join(facts["website_opportunities"]),
        lead_score=facts["lead_score"],
        previous_interactions="\n".join(facts["previous_interactions"]),
        outreach_history="\n".join(facts["outreach_history"]),
        objections="\n".join(facts["objections"]),
        questions_to_ask="\n".join(questions_to_ask),
        likely_requirements="\n".join(likely_requirements),
        possible_package=facts["possible_package"],
        suggested_pricing_range=facts["suggested_pricing_range"],
        flagged_for_review=flagged_for_review,
        review_notes=review_notes,
        model_used=model_used,
        prompt_version=meeting_brief_agent.PROMPT_VERSION,
    )
    db.add(brief)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="meeting",
        entity_id=meeting.id,
        action="brief_generated",
        summary=f"Prepared meeting brief for {meeting.title}",
    )


def regenerate_brief(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, meeting_id: uuid.UUID
) -> MeetingRead | None:
    """
    Explicit on-demand (re)generation — e.g. after a new Sales Audit
    lands, or for a meeting booked before this feature existed.
    Overwrites any existing brief. Lead-side (sales) meetings only, same
    restriction as automatic generation on booking.
    """
    meeting = db.scalar(_base_query(workspace_id).where(Meeting.id == meeting_id))
    if meeting is None:
        return None
    if meeting.lead is None:
        raise HTTPException(status_code=400, detail="Only lead-side (sales) meetings have a meeting brief")

    if meeting.brief is not None:
        db.delete(meeting.brief)
        db.flush()

    _generate_brief(db, workspace_id, actor_id, meeting, meeting.lead)
    db.commit()
    return get_meeting(db, workspace_id, meeting_id)


def create_meeting(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: MeetingCreate
) -> MeetingRead:
    project: Project | None = None
    lead: Lead | None = None

    if data.project_id is not None:
        project = _get_project_in_workspace(db, workspace_id, data.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
    else:
        lead = _get_lead_in_workspace(db, workspace_id, data.lead_id)
        if lead is None:
            raise HTTPException(status_code=404, detail="Lead not found")

    meeting_type = data.meeting_type or (MeetingType.CLIENT_CHECK_IN if project else MeetingType.SALES_CALL)

    if "assigned_user_id" in data.model_fields_set:
        assigned_user_id = data.assigned_user_id
        if assigned_user_id is not None:
            require_user_in_workspace(db, workspace_id, assigned_user_id)
    else:
        assigned_user_id = project.assigned_user_id if project else lead.assigned_user_id

    meeting = Meeting(
        title=data.title,
        meeting_type=meeting_type,
        scheduled_at=data.scheduled_at,
        duration_minutes=data.duration_minutes,
        project_id=data.project_id,
        lead_id=data.lead_id,
        assigned_user_id=assigned_user_id,
        notes=data.notes,
    )
    db.add(meeting)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="meeting",
        entity_id=meeting.id,
        action="scheduled",
        summary=f"Scheduled {meeting.title}",
    )

    # LEAD UPDATED — booking a meeting is the funnel event that moves a
    # lead into the MEETING status, unless it's already further along.
    if lead is not None and lead.status in _PRE_MEETING_STATUSES:
        previous_status = lead.status
        lead.status = LeadStatus.MEETING
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="lead",
            entity_id=lead.id,
            action="status_changed",
            summary=f"{previous_status.value} -> meeting (meeting booked)",
        )

    db.flush()

    # CALENDAR EVENT
    _sync_to_google_calendar(db, meeting)

    # MEETING BRIEF — lead-side (sales) meetings only, per the requested
    # workflow: INTERESTED LEAD -> MEETING BOOKED -> CALENDAR EVENT ->
    # LEAD UPDATED -> MEETING BRIEF.
    if lead is not None:
        _generate_brief(db, workspace_id, actor_id, meeting, lead)

    db.commit()
    return get_meeting(db, workspace_id, meeting.id)


def update_meeting(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, meeting_id: uuid.UUID, data: MeetingUpdate
) -> MeetingRead | None:
    meeting = db.scalar(_base_query(workspace_id).where(Meeting.id == meeting_id))
    if meeting is None:
        return None

    changed_fields = data.model_dump(exclude_unset=True)
    needs_calendar_sync = False
    previous_assigned_user_id = meeting.assigned_user_id

    if "title" in changed_fields:
        meeting.title = data.title
        needs_calendar_sync = True
    if "scheduled_at" in changed_fields and data.scheduled_at != meeting.scheduled_at:
        meeting.scheduled_at = data.scheduled_at
        needs_calendar_sync = True
    if "duration_minutes" in changed_fields and data.duration_minutes != meeting.duration_minutes:
        meeting.duration_minutes = data.duration_minutes
        needs_calendar_sync = True
    if "notes" in changed_fields:
        meeting.notes = data.notes
        needs_calendar_sync = True
    if "outcome" in changed_fields:
        meeting.outcome = data.outcome

    status_changed = False
    if "status" in changed_fields and data.status != meeting.status:
        meeting.status = data.status
        status_changed = True
        if data.status == MeetingStatus.HELD and meeting.held_at is None:
            meeting.held_at = datetime.now(timezone.utc)

    if "held_at" in changed_fields:
        meeting.held_at = data.held_at

    if "assigned_user_id" in data.model_fields_set and data.assigned_user_id != meeting.assigned_user_id:
        if data.assigned_user_id is not None:
            require_user_in_workspace(db, workspace_id, data.assigned_user_id)
        meeting.assigned_user_id = data.assigned_user_id
        needs_calendar_sync = True

    if changed_fields:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="meeting",
            entity_id=meeting.id,
            action="status_changed" if status_changed else "updated",
            summary=f"{meeting.title} -> {meeting.status.value}" if status_changed else meeting.title,
        )

    db.flush()

    if meeting.status in (MeetingStatus.CANCELLED, MeetingStatus.NO_SHOW):
        _remove_from_google_calendar(db, meeting)
    elif needs_calendar_sync:
        _sync_to_google_calendar(db, meeting, previous_assigned_user_id=previous_assigned_user_id)

    db.commit()
    return get_meeting(db, workspace_id, meeting_id)


def delete_meeting(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, meeting_id: uuid.UUID) -> bool:
    meeting = db.scalar(_base_query(workspace_id).where(Meeting.id == meeting_id))
    if meeting is None:
        return False

    _remove_from_google_calendar(db, meeting)

    # meeting_briefs.meeting_id is NOT NULL, so the ORM's default
    # delete-parent behavior (null out the child FK) would violate that
    # constraint — delete the loaded brief explicitly instead of relying
    # on the DB's ON DELETE CASCADE, which the ORM never reaches here.
    if meeting.brief is not None:
        db.delete(meeting.brief)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="meeting",
        entity_id=meeting.id,
        action="cancelled",
        summary=meeting.title,
    )
    db.delete(meeting)
    db.commit()
    return True
