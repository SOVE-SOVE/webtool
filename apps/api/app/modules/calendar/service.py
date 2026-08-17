import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy.orm import Session

from app.modules.calendar.schemas import CalendarEvent
from app.modules.meetings import service as meeting_service
from app.modules.meetings.models import Meeting
from app.modules.tasks import service as task_service
from app.modules.tasks.models import Task


def list_events(db: Session, workspace_id: uuid.UUID, start: date, end: date) -> list[CalendarEvent]:
    """
    Meetings (by scheduled_at) and open tasks (by due_at) within
    [start, end] inclusive, merged into one date-sorted feed. Reuses each
    module's own workspace-scoped base query and context string — see
    app/modules/meetings/service.py and app/modules/tasks/service.py —
    rather than re-deriving the project/lead join here.
    """
    range_start = datetime.combine(start, time.min, tzinfo=timezone.utc)
    range_end = datetime.combine(end, time.max, tzinfo=timezone.utc)

    meetings = db.scalars(
        meeting_service._base_query(workspace_id).where(
            Meeting.scheduled_at >= range_start, Meeting.scheduled_at <= range_end
        )
    )
    meeting_events = [
        CalendarEvent(
            kind="meeting",
            id=m.id,
            title=m.title,
            at=m.scheduled_at,
            detail=meeting_service._context(m),
            done=m.held_at is not None,
            href="/dashboard/calendar",
        )
        for m in meetings
    ]

    tasks = db.scalars(
        task_service._base_query(workspace_id).where(
            Task.due_at.isnot(None),
            Task.due_at >= range_start,
            Task.due_at <= range_end,
            Task.done.is_(False),
        )
    )
    task_events = [
        CalendarEvent(
            kind="task",
            id=t.id,
            title=t.title,
            at=t.due_at,
            detail=task_service._context(t),
            done=t.done,
            href="/dashboard/tasks",
        )
        for t in tasks
    ]

    return sorted(meeting_events + task_events, key=lambda e: e.at)
