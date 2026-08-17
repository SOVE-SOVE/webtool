import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.meetings import service
from app.modules.meetings.schemas import MeetingCreate, MeetingRead, MeetingUpdate
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/meetings", tags=["meetings"])


@router.get("", response_model=list[MeetingRead])
def list_meetings(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[MeetingRead]:
    return service.list_meetings(db, current_user.workspace_id)


@router.post("", response_model=MeetingRead, status_code=201)
def create_meeting(
    data: MeetingCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> MeetingRead:
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
