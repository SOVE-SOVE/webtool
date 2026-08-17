import uuid

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, aliased, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.leads.models import Lead
from app.modules.meetings.models import Meeting
from app.modules.meetings.schemas import MeetingCreate, MeetingRead, MeetingUpdate
from app.modules.projects.models import Project

# Meetings belong to exactly one of project or lead, and each reaches the
# workspace via a different FK chain, so both paths are joined (outer,
# since only one side is ever populated) and matched with OR — same
# pattern as app/modules/tasks/service.py.
_ProjectBusiness = aliased(Business)
_LeadBusiness = aliased(Business)


def _context(meeting: Meeting) -> str:
    if meeting.project is not None:
        return f"Project: {meeting.project.name}"
    return f"Lead: {meeting.lead.business.name}"


def _to_read(meeting: Meeting) -> MeetingRead:
    return MeetingRead(
        id=meeting.id,
        title=meeting.title,
        scheduled_at=meeting.scheduled_at,
        held_at=meeting.held_at,
        notes=meeting.notes,
        outcome=meeting.outcome,
        project_id=meeting.project_id,
        lead_id=meeting.lead_id,
        context=_context(meeting),
        created_at=meeting.created_at,
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
        .options(joinedload(Meeting.project), joinedload(Meeting.lead).joinedload(Lead.business))
    )


def list_meetings(db: Session, workspace_id: uuid.UUID) -> list[MeetingRead]:
    meetings = db.scalars(_base_query(workspace_id).order_by(Meeting.scheduled_at.asc()))
    return [_to_read(m) for m in meetings]


def get_meeting(db: Session, workspace_id: uuid.UUID, meeting_id: uuid.UUID) -> MeetingRead | None:
    meeting = db.scalar(_base_query(workspace_id).where(Meeting.id == meeting_id))
    return _to_read(meeting) if meeting else None


def _project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(Project.id)
            .join(Client, Project.client_id == Client.id)
            .join(Business, Client.business_id == Business.id)
            .where(Project.id == project_id, Business.workspace_id == workspace_id)
        )
        is not None
    )


def _lead_in_workspace(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(Lead.id)
            .join(Business, Lead.business_id == Business.id)
            .where(Lead.id == lead_id, Business.workspace_id == workspace_id)
        )
        is not None
    )


def create_meeting(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: MeetingCreate
) -> MeetingRead:
    if data.project_id is not None and not _project_in_workspace(db, workspace_id, data.project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    if data.lead_id is not None and not _lead_in_workspace(db, workspace_id, data.lead_id):
        raise HTTPException(status_code=404, detail="Lead not found")

    meeting = Meeting(
        title=data.title,
        scheduled_at=data.scheduled_at,
        project_id=data.project_id,
        lead_id=data.lead_id,
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

    db.commit()
    return get_meeting(db, workspace_id, meeting.id)


def update_meeting(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, meeting_id: uuid.UUID, data: MeetingUpdate
) -> MeetingRead | None:
    meeting = db.scalar(_base_query(workspace_id).where(Meeting.id == meeting_id))
    if meeting is None:
        return None

    changed_fields = data.model_dump(exclude_unset=True)
    if "title" in changed_fields:
        meeting.title = data.title
    if "scheduled_at" in changed_fields:
        meeting.scheduled_at = data.scheduled_at
    if "notes" in changed_fields:
        meeting.notes = data.notes

    held_now = "held_at" in changed_fields and data.held_at is not None and meeting.held_at is None
    if "held_at" in changed_fields:
        meeting.held_at = data.held_at
    if "outcome" in changed_fields:
        meeting.outcome = data.outcome

    if changed_fields:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="meeting",
            entity_id=meeting.id,
            action="held" if held_now else "updated",
            summary=meeting.title,
        )

    db.commit()
    return get_meeting(db, workspace_id, meeting_id)


def delete_meeting(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, meeting_id: uuid.UUID) -> bool:
    meeting = db.scalar(_base_query(workspace_id).where(Meeting.id == meeting_id))
    if meeting is None:
        return False

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
