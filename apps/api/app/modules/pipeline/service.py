import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.businesses.models import Business
from app.modules.leads.models import Lead, LeadStatus
from app.modules.pipeline.models import PipelineEvent, PipelineStageConfig
from app.modules.pipeline.schemas import PipelineStageUpdate

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


def list_lead_events(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> list[PipelineEvent] | None:
    """None means "no such lead in this workspace" (404), distinct from
    an empty list (a real lead with no recorded transitions yet)."""
    lead = db.scalar(
        select(Lead).join(Business, Lead.business_id == Business.id).where(
            Lead.id == lead_id, Business.workspace_id == workspace_id
        )
    )
    if lead is None:
        return None
    return list(
        db.scalars(
            select(PipelineEvent).where(PipelineEvent.lead_id == lead_id).order_by(PipelineEvent.created_at.desc())
        )
    )


# Sensible defaults for a brand-new workspace's pipeline board — the
# same sequence LeadStatus already encodes (see docs/05_DECISIONS.md
# 2026-08-16), just given board-facing labels and won/lost flags. Labels
# match the operator's requested wording where a state maps 1:1
# (RESPONDED, MEETING_BOOKED); QUALIFIED and NURTURE are kept as their
# own columns rather than dropped, since existing leads can already sit
# in either state and a board that can't show a lead's real status would
# be worse than one with two extra columns.
_DEFAULT_STAGES: list[tuple[LeadStatus, str, int, bool, bool]] = [
    (LeadStatus.NEW, "New", 0, False, False),
    (LeadStatus.RESEARCHED, "Researched", 1, False, False),
    (LeadStatus.QUALIFIED, "Qualified", 2, False, False),
    (LeadStatus.CONTACTED, "Contacted", 3, False, False),
    (LeadStatus.REPLIED, "Responded", 4, False, False),
    (LeadStatus.MEETING, "Meeting booked", 5, False, False),
    (LeadStatus.PROPOSAL, "Proposal", 6, False, False),
    (LeadStatus.WON, "Won", 7, True, False),
    (LeadStatus.LOST, "Lost", 8, False, True),
    (LeadStatus.NURTURE, "Nurture", 9, False, False),
]


def list_stages(db: Session, workspace_id: uuid.UUID) -> list[PipelineStageConfig]:
    """Lazily seeds a workspace's stage config with `_DEFAULT_STAGES` on
    first read, rather than backfilling every workspace in a migration —
    same pattern as other lazily-seeded per-workspace config in this
    codebase."""
    existing = list(
        db.scalars(
            select(PipelineStageConfig)
            .where(PipelineStageConfig.workspace_id == workspace_id)
            .order_by(PipelineStageConfig.sort_order)
        )
    )
    existing_keys = {stage.key for stage in existing}
    missing = [d for d in _DEFAULT_STAGES if d[0] not in existing_keys]
    if not missing:
        return existing

    for key, label, sort_order, is_won, is_lost in missing:
        db.add(
            PipelineStageConfig(
                workspace_id=workspace_id,
                key=key,
                label=label,
                sort_order=sort_order,
                is_won=is_won,
                is_lost=is_lost,
            )
        )
    db.commit()

    return list(
        db.scalars(
            select(PipelineStageConfig)
            .where(PipelineStageConfig.workspace_id == workspace_id)
            .order_by(PipelineStageConfig.sort_order)
        )
    )


def update_stage(
    db: Session, workspace_id: uuid.UUID, stage_id: uuid.UUID, data: PipelineStageUpdate
) -> PipelineStageConfig | None:
    stage = db.scalar(
        select(PipelineStageConfig).where(
            PipelineStageConfig.id == stage_id, PipelineStageConfig.workspace_id == workspace_id
        )
    )
    if stage is None:
        return None
    if data.label is not None:
        stage.label = data.label
    if data.sort_order is not None:
        stage.sort_order = data.sort_order
    db.commit()
    db.refresh(stage)
    return stage
