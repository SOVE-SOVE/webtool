import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, model_validator

from app.modules.meetings.models import MeetingBrief, ReminderChannel, MeetingStatus, MeetingType


def _split(text: str) -> list[str]:
    return [p for p in text.split("\n") if p]


class MeetingAttendeeCreate(BaseModel):
    email: EmailStr
    name: str | None = None
    is_organizer: bool = False


class MeetingAttendeeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    email: str
    is_organizer: bool
    created_at: datetime


class MeetingReminderCreate(BaseModel):
    remind_at: datetime
    channel: ReminderChannel = ReminderChannel.IN_APP
    note: str | None = None


class MeetingReminderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    remind_at: datetime
    channel: ReminderChannel
    note: str | None
    acknowledged_at: datetime | None
    created_at: datetime


class DueReminderRead(BaseModel):
    """A reminder that's come due, with enough meeting context to show
    in a standalone list (e.g. the calendar page) without a second
    lookup — see service.list_due_reminders."""

    id: uuid.UUID
    remind_at: datetime
    channel: ReminderChannel
    note: str | None
    meeting_id: uuid.UUID
    meeting_title: str
    meeting_scheduled_at: datetime
    meeting_context: str


class MeetingBriefRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID

    # BUSINESS
    business_name: str
    business_industry: str | None
    business_location: str | None
    business_website: str | None

    # WEBSITE
    website_strengths: list[str]
    website_weaknesses: list[str]
    website_opportunities: list[str]

    # SALES
    lead_score: int | None
    previous_interactions: list[str]
    outreach_history: list[str]
    objections: list[str]

    # DISCOVERY
    questions_to_ask: list[str]
    likely_requirements: list[str]
    possible_package: str
    suggested_pricing_range: str

    flagged_for_review: bool
    review_notes: str | None
    generated_at: datetime

    @staticmethod
    def from_model(brief: MeetingBrief) -> "MeetingBriefRead":
        return MeetingBriefRead(
            id=brief.id,
            business_name=brief.business_name,
            business_industry=brief.business_industry,
            business_location=brief.business_location,
            business_website=brief.business_website,
            website_strengths=_split(brief.website_strengths),
            website_weaknesses=_split(brief.website_weaknesses),
            website_opportunities=_split(brief.website_opportunities),
            lead_score=brief.lead_score,
            previous_interactions=_split(brief.previous_interactions),
            outreach_history=_split(brief.outreach_history),
            objections=_split(brief.objections),
            questions_to_ask=_split(brief.questions_to_ask),
            likely_requirements=_split(brief.likely_requirements),
            possible_package=brief.possible_package,
            suggested_pricing_range=brief.suggested_pricing_range,
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
    # Optional convenience — attendees/reminders can also be added
    # individually after creation via POST /meetings/{id}/attendees and
    # /meetings/{id}/reminders.
    attendees: list[MeetingAttendeeCreate] = []
    reminders: list[MeetingReminderCreate] = []

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
    attendees: list[MeetingAttendeeRead] = []
    reminders: list[MeetingReminderRead] = []
