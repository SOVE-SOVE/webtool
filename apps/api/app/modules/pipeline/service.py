import uuid

from sqlalchemy.orm import Session

from app.modules.pipeline.models import PipelineEvent

# Distinct from activity_log (who did what, across every entity type) —
# this is specifically the stage-transition history for a lead or
# project, per PipelineEvent's own docstring. Callers are the handful of
# places that actually flip `Project.stage` or `Lead.status`
# (projects/service.py's advance_stage, leads/service.py's manual PATCH
# and mark_researched, clients/service.py's WON conversion,
# meetings/service.py's MEETING bump) — not every action in the app.


def record_project_event(db: Session, *, project_id: uuid.UUID, kind: str, summary: str | None = None) -> None:
    db.add(PipelineEvent(project_id=project_id, kind=kind, summary=summary))


def record_lead_event(db: Session, *, lead_id: uuid.UUID, kind: str, summary: str | None = None) -> None:
    db.add(PipelineEvent(lead_id=lead_id, kind=kind, summary=summary))
