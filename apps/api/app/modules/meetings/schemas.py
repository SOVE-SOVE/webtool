import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator

from app.modules.meetings.models import MeetingBrief, MeetingStatus, MeetingType


class MeetingBriefRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    summary: str
    talking_points: list[str]
    open_items: list[str]
    flagged_for_review: bool
    review_notes: str | None
    generated_at: datetime

    @staticmethod
    def from_model(brief: MeetingBrief) -> "MeetingBriefRead":
        return MeetingBriefRead(
            id=brief.id,
            summary=brief.summary,
            talking_points=[p for p in brief.talking_points.split("\n") if p],
            open_items=[p for p in brief.open_items.split("\n") if p],
            flagged_for_review=brief.flagged_for_review,
            review_notes=brief.review_notes,
            generated_at=brief.generated_at,
        )


class MeetingCreate(BaseModel):
    title: str
    # Defaulted server-side from the parent (lead -> sales_call, project
    # -> client_check_in) when omitted — see service.create_meeting.
    meeting_type: MeetingType | None = None
    scheduled_at: datetime
    duration_minutes: int = 30
    project_id: uuid.UUID | None = None
    lead_id: uuid.UUID | None = None
    # Omitted -> defaults to the parent lead/project's own assigned
    # user. Explicitly present (including null) -> used as given. See
    # LeadUpdate in modules/leads/schemas.py for the same
    # present-vs-omitted convention.
    assigned_user_id: uuid.UUID | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _exactly_one_parent(self) -> "MeetingCreate":
        if bool(self.project_id) == bool(self.lead_id):
            raise ValueError("Provide exactly one of project_id or lead_id")
        return self


class MeetingUpdate(BaseModel):
    title: str | None = None
    scheduled_at: datetime | None = None
    duration_minutes: int | None = None
    status: MeetingStatus | None = None
    held_at: datetime | None = None
    notes: str | None = None
    outcome: str | None = None
    # See MeetingCreate above — null unassigns, omitted leaves untouched.
    assigned_user_id: uuid.UUID | None = None


class MeetingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    meeting_type: MeetingType
    status: MeetingStatus
    scheduled_at: datetime
    duration_minutes: int
    held_at: datetime | None
    notes: str | None
    outcome: str | None
    project_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    assigned_user_id: uuid.UUID | None
    assigned_user_name: str | None
    synced_to_calendar: bool
    context: str
    created_at: datetime
    brief: MeetingBriefRead | None = None
