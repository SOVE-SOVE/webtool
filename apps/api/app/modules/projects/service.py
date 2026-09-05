import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.deployments.models import Deployment
from app.modules.pipeline import service as pipeline_service
from app.modules.projects.models import Project, ProjectStage
from app.modules.projects.schemas import (
    DeliveryChecklistItemRead,
    DeliveryStatusRead,
    ProjectCreate,
    ProjectRead,
    ProjectUpdate,
)
from app.modules.tasks.models import Task
from app.modules.users.service import require_user_in_workspace
from app.modules.websites.models import Website

_STAGE_ORDER = list(ProjectStage)


def advance_stage(
    db: Session, *, workspace_id: uuid.UUID, actor_id: uuid.UUID | None, project: Project, new_stage: ProjectStage
) -> bool:
    """
    Moves a project's stage forward only — never regresses a stage
    that's already further along (or re-triggers the same one), same
    "only forward" contract as meetings/service.py's lead-status bump.
    This is the single place every generation/approval action in the
    delivery pipeline (brief, creative direction, sitemap, website, QA,
    client review, deployment) nudges the project's stage — connecting
    those modules' own approval state to the pipeline view instead of
    leaving `Project.stage` static past BRIEF. An operator's manual
    stage change (ProjectUpdate, below) is unrestricted and separate —
    only the automatic nudges use this guard.

    Returns whether the stage actually moved, so a caller can hang
    once-per-project side effects (e.g. seeding the launch checklist on
    the first successful deploy) off the real transition rather than
    re-running them on every repeat call.
    """
    if _STAGE_ORDER.index(new_stage) <= _STAGE_ORDER.index(project.stage):
        return False
    previous = project.stage
    project.stage = new_stage
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="stage_changed",
        summary=f"{previous.value} -> {new_stage.value}",
    )
    pipeline_service.record_project_event(
        db, project_id=project.id, kind="stage_changed", summary=f"{previous.value} -> {new_stage.value}"
    )
    return True

# Seeded on every new project so INTAKE never starts as an empty to-do
# list — the concrete first steps of docs/01_REQUIREMENTS.md stage 9
# (client intake). Operators edit/add/remove from here via the normal
# task routes; this is just the starting checklist, not a fixed workflow.
DEFAULT_INTAKE_TASK_TITLES = [
    "Confirm project scope and deliverables with client",
    "Collect brand assets and content from client",
    "Schedule kickoff/intake call",
]

# Seeded the first time a project actually reaches DEPLOYED — the
# handover/admin steps that happen after the site is live and are the
# easiest to forget once the build itself is done. Same "starting
# checklist, not a fixed workflow" contract as the intake list above.
DEFAULT_LAUNCH_TASK_TITLES = [
    "Hand over domain, hosting, and CMS logins to the client",
    "Set up analytics and confirm it's recording traffic",
    "Send the client the live URL and a short handover note",
    "Send the final invoice",
    "Ask the client for a testimonial and a Google review",
]


def _to_read(project: Project) -> ProjectRead:
    return ProjectRead(
        id=project.id,
        client_id=project.client_id,
        business_id=project.client.business_id,
        client_business_name=project.client.business.name,
        source_lead_id=project.source_lead_id,
        name=project.name,
        stage=project.stage,
        package=project.package,
        price_cents=project.price_cents,
        deadline=project.deadline,
        build_direction=project.build_direction,
        assigned_user_id=project.assigned_user_id,
        assigned_user_name=project.assigned_user.name if project.assigned_user else None,
        delivered_at=project.delivered_at,
        delivered_by_user_name=project.delivered_by_user.name if project.delivered_by_user else None,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def create_default_tasks(db: Session, project_id: uuid.UUID) -> None:
    """Seeds the initial INTAKE task checklist for a newly created project."""
    for title in DEFAULT_INTAKE_TASK_TITLES:
        db.add(Task(project_id=project_id, title=title))


def create_launch_tasks(db: Session, project_id: uuid.UUID) -> None:
    """Seeds the post-launch handover checklist. Only ever called behind
    a successful `advance_stage(... DEPLOYED)`, which returns True once
    per project, so a redeploy or rollback never duplicates these."""
    for title in DEFAULT_LAUNCH_TASK_TITLES:
        db.add(Task(project_id=project_id, title=title))


def _base_query(workspace_id: uuid.UUID):
    return (
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(
            joinedload(Project.client).joinedload(Client.business),
            joinedload(Project.assigned_user),
            joinedload(Project.delivered_by_user),
        )
    )


def list_projects(db: Session, workspace_id: uuid.UUID) -> list[ProjectRead]:
    projects = db.scalars(_base_query(workspace_id).order_by(Project.created_at.desc()))
    return [_to_read(p) for p in projects]


def get_project(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> ProjectRead | None:
    project = db.scalar(_base_query(workspace_id).where(Project.id == project_id))
    return _to_read(project) if project else None


def _get_client_in_workspace(db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID) -> Client | None:
    return db.scalar(
        select(Client)
        .join(Business, Client.business_id == Business.id)
        .where(Client.id == client_id, Business.workspace_id == workspace_id)
    )


def create_project(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: ProjectCreate
) -> ProjectRead:
    if _get_client_in_workspace(db, workspace_id, data.client_id) is None:
        raise HTTPException(status_code=404, detail="Client not found")

    if data.assigned_user_id is not None:
        require_user_in_workspace(db, workspace_id, data.assigned_user_id)

    project = Project(
        client_id=data.client_id,
        name=data.name,
        assigned_user_id=data.assigned_user_id,
        package=data.package,
        price_cents=data.price_cents,
        deadline=data.deadline,
    )
    db.add(project)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="created",
        summary=f"Created project {project.name}",
    )

    db.commit()
    db.refresh(project)
    return get_project(db, workspace_id, project.id)  # reload with the joined client/business


def update_project(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    project_id: uuid.UUID,
    data: ProjectUpdate,
) -> ProjectRead | None:
    project = db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Project.id == project_id, Business.workspace_id == workspace_id)
    )
    if project is None:
        return None

    if data.stage is not None and data.stage != project.stage:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=project.id,
            action="stage_changed",
            summary=f"{project.stage.value} -> {data.stage.value}",
        )
        pipeline_service.record_project_event(
            db,
            project_id=project.id,
            kind="stage_changed",
            summary=f"{project.stage.value} -> {data.stage.value}",
        )
        project.stage = data.stage

    if "package" in data.model_fields_set:
        project.package = data.package
    if "price_cents" in data.model_fields_set:
        project.price_cents = data.price_cents
    if "deadline" in data.model_fields_set:
        project.deadline = data.deadline
    if "build_direction" in data.model_fields_set:
        project.build_direction = data.build_direction

    if "assigned_user_id" in data.model_fields_set and data.assigned_user_id != project.assigned_user_id:
        if data.assigned_user_id is not None:
            require_user_in_workspace(db, workspace_id, data.assigned_user_id)
        project.assigned_user_id = data.assigned_user_id
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=project.id,
            action="assigned",
            summary="Unassigned" if data.assigned_user_id is None else "Reassigned",
        )

    db.commit()
    return get_project(db, workspace_id, project_id)


def _get_project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Project.id == project_id, Business.workspace_id == workspace_id)
    )


def _latest_deployment(db: Session, project_id: uuid.UUID) -> Deployment | None:
    return db.scalar(
        select(Deployment)
        .join(Website, Deployment.website_id == Website.id)
        .where(Website.project_id == project_id)
        .order_by(Deployment.created_at.desc())
    )


def _delivery_checklist_tasks(db: Session, project_id: uuid.UUID) -> list[Task]:
    return list(
        db.scalars(
            select(Task)
            .where(Task.project_id == project_id, Task.title.in_(DEFAULT_LAUNCH_TASK_TITLES))
            .order_by(Task.created_at)
        )
    )


def get_delivery_status(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> DeliveryStatusRead | None:
    """
    Everything still blocking `mark_delivered`, all at once — same
    "report every missing thing together" shape as
    modules/approvals/service.py's ProjectApprovalStatus, so the
    operator never has to fix one gap only to discover another on the
    next attempt. The checklist here *is* the "final delivery
    checklist": the launch-handover tasks seeded on first deploy (see
    DEFAULT_LAUNCH_TASK_TITLES) — a project can't be delivered with any
    of them still unchecked.
    """
    project = _get_project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None

    deployment = _latest_deployment(db, project_id)
    has_successful_deployment = deployment is not None and deployment.status == "success"
    deployment_verified = has_successful_deployment and deployment.verified_at is not None
    checklist = _delivery_checklist_tasks(db, project_id)

    missing: list[str] = []
    if project.delivered_at is not None:
        missing.append("this project has already been marked delivered")
    if not has_successful_deployment:
        missing.append("a successful deployment")
    elif not deployment_verified:
        missing.append("deployment verification")
    unchecked = [t.title for t in checklist if not t.done]
    if unchecked:
        missing.append(f"final delivery checklist item(s): {', '.join(unchecked)}")

    return DeliveryStatusRead(
        can_deliver=not missing,
        already_delivered=project.delivered_at is not None,
        has_successful_deployment=has_successful_deployment,
        deployment_verified=deployment_verified,
        latest_deployment_url=deployment.url if deployment else None,
        checklist=[DeliveryChecklistItemRead(task_id=t.id, title=t.title, done=t.done) for t in checklist],
        missing=missing,
    )


def mark_delivered(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID) -> ProjectRead | None:
    """
    The final "mark project delivered" handover action (docs/04_ROADMAP.md
    M6's delivery workflow: approve -> deploy -> monitor -> receive URL
    -> verify -> deliver). Refuses outright — never silently proceeds —
    unless `get_delivery_status` reports nothing missing: a verified,
    successful deployment and every final-delivery-checklist item
    checked off. Records who/when, and this is the only place
    `Project.delivered_at` is ever set.
    """
    status = get_delivery_status(db, workspace_id, project_id)
    if status is None:
        return None
    if not status.can_deliver:
        raise HTTPException(status_code=400, detail=f"Cannot mark this project delivered — still missing: {'; '.join(status.missing)}.")

    project = _get_project_in_workspace(db, workspace_id, project_id)
    project.delivered_at = datetime.now(timezone.utc)
    project.delivered_by_user_id = actor_id
    advance_stage(db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.COMPLETE)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project_id,
        action="project_delivered",
        summary=f"Marked delivered — live at {status.latest_deployment_url}",
    )

    db.commit()
    return get_project(db, workspace_id, project_id)
