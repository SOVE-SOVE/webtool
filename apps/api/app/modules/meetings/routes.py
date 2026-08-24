import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.rate_limit import enforce_generation_rate_limit
from app.db.session import get_db
from app.modules.meetings import service
from app.modules.meetings.schemas import (
    DueReminderRead,
    MeetingAttendeeCreate,
    MeetingCreate,
    MeetingRead,
    MeetingReminderCreate,
    MeetingUpdate,
)
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/meetings", tags=["meetings"])


@router.get("", response_model=list[MeetingRead])
def list_meetings(
    lead_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MeetingRead]:
    """
    Unfiltered for the calendar page; lead_id/project_id scopes it to
    that one lead's or project's meeting history.
    """
    return service.list_meetings(db, current_user.workspace_id, lead_id=lead_id, project_id=project_id)


@router.get("/reminders/due", response_model=list[DueReminderRead])
def list_due_reminders(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DueReminderRead]:
    return service.list_due_reminders(db, current_user.workspace_id)


@router.post("", response_model=MeetingRead, status_code=201)
def create_meeting(
    data: MeetingCreate,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> MeetingRead:
    """
    Rate-limited like the other generation endpoints — booking a
    lead-side meeting triggers automatic meeting-brief generation
    (project-side meetings don't; see service.py's MeetingBrief
    docstring for what's deterministic vs. LLM-generated in that brief).
    Sharing one rate-limit bucket is simpler than a conditional
    dependency and meeting creation isn't high-frequency enough for that
    to matter — see app/core/rate_limit.py.
    """
    return service.create_meeting(db, current_user.workspace_id, current_user.id, data)


@router.get("/{meeting_id}", response_model=MeetingRead)
def get_meeting(
    meeting_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> MeetingRead:
    meeting = service.get_meeting(db, current_user.workspace_id, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.patch("/{meeting_id}", response_model=MeetingRead)
def update_meeting(
    meeting_id: uuid.UUID,
    data: MeetingUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingRead:
    meeting = service.update_meeting(db, current_user.workspace_id, current_user.id, meeting_id, data)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.delete("/{meeting_id}", status_code=204)
def delete_meeting(
    meeting_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    if not service.delete_meeting(db, current_user.workspace_id, current_user.id, meeting_id):
        raise HTTPException(status_code=404, detail="Meeting not found")


@router.post("/{meeting_id}/brief", response_model=MeetingRead)
def generate_meeting_brief(
    meeting_id: uuid.UUID,
    current_user: User = Depends(enforce_generation_rate_limit),
    db: Session = Depends(get_db),
) -> MeetingRead:
    """On-demand (re)generation — see service.regenerate_brief."""
    meeting = service.regenerate_brief(db, current_user.workspace_id, current_user.id, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.post("/{meeting_id}/attendees", response_model=MeetingRead, status_code=201)
def add_attendee(
    meeting_id: uuid.UUID,
    data: MeetingAttendeeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingRead:
    meeting = service.add_attendee(db, current_user.workspace_id, current_user.id, meeting_id, data)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.delete("/{meeting_id}/attendees/{attendee_id}", response_model=MeetingRead)
def remove_attendee(
    meeting_id: uuid.UUID,
    attendee_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingRead:
    meeting = service.remove_attendee(db, current_user.workspace_id, current_user.id, meeting_id, attendee_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.post("/{meeting_id}/reminders", response_model=MeetingRead, status_code=201)
def add_reminder(
    meeting_id: uuid.UUID,
    data: MeetingReminderCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingRead:
    meeting = service.add_reminder(db, current_user.workspace_id, current_user.id, meeting_id, data)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.delete("/{meeting_id}/reminders/{reminder_id}", response_model=MeetingRead)
def remove_reminder(
    meeting_id: uuid.UUID,
    reminder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingRead:
    meeting = service.remove_reminder(db, current_user.workspace_id, current_user.id, meeting_id, reminder_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.post("/{meeting_id}/reminders/{reminder_id}/acknowledge", response_model=MeetingRead)
def acknowledge_reminder(
    meeting_id: uuid.UUID,
    reminder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MeetingRead:
    meeting = service.acknowledge_reminder(db, current_user.workspace_id, meeting_id, reminder_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting
