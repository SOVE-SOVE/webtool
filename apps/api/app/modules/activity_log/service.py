import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log.models import ActivityLog
from app.modules.activity_log.schemas import ActivityRead


def record(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID | None,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    summary: str | None = None,
) -> None:
    """
    Stages the row on the session without committing — callers already
    commit as part of the mutation being recorded, so this rides along
    in the same transaction instead of adding a second round trip.
    """
    db.add(
        ActivityLog(
            workspace_id=workspace_id,
            user_id=user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            summary=summary,
        )
    )


def _to_read(entry: ActivityLog) -> ActivityRead:
    return ActivityRead(
        id=entry.id,
        user_id=entry.user_id,
        user_name=entry.user.name if entry.user else None,
        entity_type=entry.entity_type,
        entity_id=entry.entity_id,
        action=entry.action,
        summary=entry.summary,
        created_at=entry.created_at,
    )


def list_activity(db: Session, workspace_id: uuid.UUID, limit: int = 50) -> list[ActivityRead]:
    entries = db.scalars(
        select(ActivityLog)
        .options(joinedload(ActivityLog.user))
        .where(ActivityLog.workspace_id == workspace_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    return [_to_read(e) for e in entries]
