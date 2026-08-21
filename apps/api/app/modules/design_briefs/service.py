import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.design_briefs.models import BriefStatus, DesignBrief
from app.modules.design_briefs.schemas import BriefIntakeStart, BriefRead, BriefUpdate
from app.modules.projects import service as projects_service
from app.modules.projects.models import Project, ProjectStage

# Every intake field the brief tracks (BriefIntakeStart's extra
# project_name is deliberately not here — it names the project, not a
# brief column). Used to apply a partial update generically instead of
# listing all ~35 columns by hand.
_BRIEF_FIELDS = list(BriefUpdate.model_fields)


def _get_client_in_workspace(db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID) -> Client | None:
    return db.scalar(
        select(Client)
        .join(Business, Client.business_id == Business.id)
        .where(Client.id == client_id, Business.workspace_id == workspace_id)
        .options(joinedload(Client.business))
    )


def _get_project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Project.id == project_id, Business.workspace_id == workspace_id)
    )


def _load_brief(db: Session, brief_id: uuid.UUID) -> DesignBrief:
    return db.scalar(
        select(DesignBrief)
        .where(DesignBrief.id == brief_id)
        .options(joinedload(DesignBrief.approved_by_user))
    )


def _get_or_create_draft(db: Session, project: Project) -> DesignBrief:
    """One brief per project — created lazily on first touch (get or
    update) rather than requiring a separate explicit "create" step for
    projects that already existed before intake started."""
    brief = db.scalar(select(DesignBrief).where(DesignBrief.project_id == project.id))
    if brief is None:
        brief = DesignBrief(project_id=project.id)
        db.add(brief)
        db.flush()
    return brief


def _apply_fields(brief: DesignBrief, data: BriefUpdate) -> bool:
    """Applies every field present in the request body (exclude_unset,
    same convention as ProjectUpdate/ClientUpdate elsewhere). Returns
    whether anything actually changed value."""
    changed = False
    for field, value in data.model_dump(exclude_unset=True).items():
        if field not in _BRIEF_FIELDS:
            continue
        if getattr(brief, field) != value:
            setattr(brief, field, value)
            changed = True
    return changed


# A project past these stages is finished work — a client coming back
# for a second site should get a genuinely new project, not have their
# closed one reopened.
_FINISHED_STAGES = (ProjectStage.MAINTENANCE, ProjectStage.COMPLETE)


def _active_project_for_client(db: Session, client_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .where(Project.client_id == client_id, Project.stage.not_in(_FINISHED_STAGES))
        .order_by(Project.created_at.desc())
    )


def _apply_fields_where_empty(brief: DesignBrief, data: BriefIntakeStart) -> None:
    """Pre-fill that never clobbers: writes a supplied value only where
    the brief's own field is still empty."""
    for field, value in data.model_dump(exclude_unset=True).items():
        if field not in _BRIEF_FIELDS or value in (None, ""):
            continue
        if getattr(brief, field) in (None, ""):
            setattr(brief, field, value)


def start_intake(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, client_id: uuid.UUID, data: BriefIntakeStart
) -> BriefRead | None:
    """
    Client intake form → auto-creates a project record (roadmap M4):
    given a won client, creates a project (INTAKE stage) plus its brief
    in one step, pre-filled with whatever intake info was collected up
    front, and seeded with the same starter checklist a lead-to-client
    conversion gets.

    Idempotent by default: if the client already has an unfinished
    project, this returns that project's brief instead of creating a
    second one. Clicking "Start intake" twice used to silently produce
    duplicate projects with no way to delete either. A client genuinely
    can have more than one project over time, so `force_new` is the
    deliberate opt-in for that case.
    """
    client = _get_client_in_workspace(db, workspace_id, client_id)
    if client is None:
        return None

    if not data.force_new:
        existing = _active_project_for_client(db, client.id)
        if existing is not None:
            brief = _get_or_create_draft(db, existing)
            # Only fills gaps — an operator's own answers are never
            # overwritten by re-running the pre-fill.
            _apply_fields_where_empty(brief, data)
            db.commit()
            return BriefRead.from_model(_load_brief(db, brief.id))

    project_name = data.project_name or f"{client.business.name} — Website"
    project = Project(client_id=client.id, name=project_name)
    db.add(project)
    db.flush()

    brief = DesignBrief(project_id=project.id)
    _apply_fields(brief, data)
    db.add(brief)
    db.flush()

    projects_service.create_default_tasks(db, project.id)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="created",
        summary=f"Started intake for {project_name}",
    )

    db.commit()
    return BriefRead.from_model(_load_brief(db, brief.id))


def get_brief(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> BriefRead | None:
    project = _get_project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None
    brief = _get_or_create_draft(db, project)
    db.commit()
    return BriefRead.from_model(_load_brief(db, brief.id))


def update_brief(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID, data: BriefUpdate
) -> BriefRead | None:
    project = _get_project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None

    brief = _get_or_create_draft(db, project)
    changed = _apply_fields(brief, data)

    if changed and brief.status == BriefStatus.APPROVED:
        # The approved brief is the source of truth for design — once its
        # content actually changes, that sign-off no longer describes what's
        # in front of the operator, so it reverts to draft rather than
        # silently drifting out of sync with what was approved.
        brief.status = BriefStatus.DRAFT
        brief.approved_at = None
        brief.approved_by_user_id = None
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=project.id,
            action="brief_reverted_to_draft",
            summary="Brief edited after approval — reverted to draft",
        )
    elif changed:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=project.id,
            action="brief_updated",
            summary="Brief updated",
        )

    db.commit()
    return BriefRead.from_model(_load_brief(db, brief.id))


def approve_brief(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID
) -> BriefRead | None:
    project = _get_project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None

    brief = _get_or_create_draft(db, project)
    brief.status = BriefStatus.APPROVED
    brief.approved_at = datetime.now(timezone.utc)
    brief.approved_by_user_id = actor_id

    # Approving the brief is what "design begins" waits on — advance the
    # project past intake so the pipeline reflects it.
    projects_service.advance_stage(
        db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.BRIEF
    )

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="brief_approved",
        summary="Brief approved — ready for design",
    )

    db.commit()
    return BriefRead.from_model(_load_brief(db, brief.id))
