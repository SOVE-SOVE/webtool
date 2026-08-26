import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.project_plans.models import PlanStageStatus, ProjectStagePlan
from app.modules.project_plans.schemas import PlanStageRead, PlanStageUpdate, ProjectPlanRead
from app.modules.projects.models import Project, ProjectStage
from app.modules.tasks.models import Task
from app.modules.users.service import require_user_in_workspace

_STAGE_ORDER = list(ProjectStage)

_LABELS: dict[ProjectStage, str] = {
    ProjectStage.INTAKE: "Intake",
    ProjectStage.RESEARCH: "Research",
    ProjectStage.BRIEF: "Client brief",
    ProjectStage.DESIGN: "Design",
    ProjectStage.DEVELOPMENT: "Development",
    ProjectStage.QA: "QA",
    ProjectStage.CLIENT_REVIEW: "Client review",
    ProjectStage.REVISIONS: "Revisions",
    ProjectStage.READY_TO_DEPLOY: "Ready to deploy",
    ProjectStage.DEPLOYED: "Deployed",
    ProjectStage.MAINTENANCE: "Maintenance",
    ProjectStage.COMPLETE: "Complete",
}

# Stages the operator can't rubber-stamp past without a real sign-off —
# mirrors modules/approvals/service.py's seven checkpoints (brief,
# creative direction, sitemap, generated website, QA, client review,
# final deployment), mapped onto the plan stage each checkpoint lands
# on. DESIGN covers both creative direction and sitemap; READY_TO_DEPLOY
# is the gate the deployment checkpoint guards.
_REQUIRES_APPROVAL = {
    ProjectStage.BRIEF,
    ProjectStage.DESIGN,
    ProjectStage.DEVELOPMENT,
    ProjectStage.QA,
    ProjectStage.CLIENT_REVIEW,
    ProjectStage.READY_TO_DEPLOY,
}

# Default duration (in days) budgeted for each stage, used only to
# stagger sensible default due dates from today. Purely a starting
# estimate — every date is immediately editable, same "sensible default,
# not a schedule the operator is bound to" contract as the rest of this
# plan.
_DEFAULT_DURATION_DAYS: dict[ProjectStage, int] = {
    ProjectStage.INTAKE: 2,
    ProjectStage.RESEARCH: 2,
    ProjectStage.BRIEF: 3,
    ProjectStage.DESIGN: 5,
    ProjectStage.DEVELOPMENT: 10,
    ProjectStage.QA: 3,
    ProjectStage.CLIENT_REVIEW: 3,
    ProjectStage.REVISIONS: 5,
    ProjectStage.READY_TO_DEPLOY: 2,
    ProjectStage.DEPLOYED: 1,
    ProjectStage.MAINTENANCE: 0,
    ProjectStage.COMPLETE: 0,
}

# Starter checklist per stage, seeded onto the shared Task table (tagged
# with `stage` so it groups under its plan row) — same "starting
# checklist, not a fixed workflow" contract as projects/service.py's
# DEFAULT_INTAKE_TASK_TITLES/DEFAULT_LAUNCH_TASK_TITLES. INTAKE and
# DEPLOYED are deliberately absent: INTAKE's checklist is already seeded
# by create_default_tasks at project creation, and DEPLOYED's by
# create_launch_tasks the first time the project actually reaches it —
# seeding either again here would duplicate them.
_DEFAULT_STAGE_TASKS: dict[ProjectStage, list[str]] = {
    ProjectStage.RESEARCH: ["Review prior sales research and audit findings"],
    ProjectStage.DESIGN: ["Generate and review creative direction", "Generate and approve sitemap"],
    ProjectStage.DEVELOPMENT: ["Generate website", "Review generated sections against the brief"],
    ProjectStage.QA: ["Run technical QA", "Resolve critical QA issues"],
    ProjectStage.CLIENT_REVIEW: ["Share preview with client", "Record client feedback/approval"],
    ProjectStage.REVISIONS: ["Apply requested changes"],
    ProjectStage.READY_TO_DEPLOY: ["Confirm deployment checklist", "Deploy site"],
}


def _project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Project.id == project_id, Business.workspace_id == workspace_id)
    )


def _stage_plan_in_workspace(
    db: Session, workspace_id: uuid.UUID, stage_plan_id: uuid.UUID
) -> ProjectStagePlan | None:
    return db.scalar(
        select(ProjectStagePlan)
        .join(Project, ProjectStagePlan.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(ProjectStagePlan.id == stage_plan_id, Business.workspace_id == workspace_id)
        .options(
            joinedload(ProjectStagePlan.responsible_user), joinedload(ProjectStagePlan.approved_by_user)
        )
    )


def _task_counts(db: Session, project_id: uuid.UUID) -> dict[ProjectStage, tuple[int, int]]:
    tasks = db.scalars(select(Task).where(Task.project_id == project_id, Task.stage.is_not(None)))
    counts: dict[ProjectStage, list[int]] = {}
    for task in tasks:
        bucket = counts.setdefault(task.stage, [0, 0])
        bucket[0] += 1
        if task.done:
            bucket[1] += 1
    return {stage: (total, done) for stage, (total, done) in counts.items()}


def _to_read(stage_plan: ProjectStagePlan, task_count: int, tasks_done: int) -> PlanStageRead:
    return PlanStageRead(
        id=stage_plan.id,
        project_id=stage_plan.project_id,
        stage=stage_plan.stage,
        label=stage_plan.label,
        sort_order=stage_plan.sort_order,
        responsible_user_id=stage_plan.responsible_user_id,
        responsible_user_name=stage_plan.responsible_user.name if stage_plan.responsible_user else None,
        due_at=stage_plan.due_at,
        requires_approval=stage_plan.requires_approval,
        status=stage_plan.status,
        approved=stage_plan.approved,
        approved_by_user_id=stage_plan.approved_by_user_id,
        approved_by_user_name=(
            stage_plan.approved_by_user.name if stage_plan.approved_by_user else None
        ),
        approved_at=stage_plan.approved_at,
        task_count=task_count,
        tasks_done=tasks_done,
    )


def has_plan(db: Session, project_id: uuid.UUID) -> bool:
    return (
        db.scalar(select(ProjectStagePlan.id).where(ProjectStagePlan.project_id == project_id).limit(1))
        is not None
    )


def create_plan_for_project(
    db: Session, *, workspace_id: uuid.UUID, actor_id: uuid.UUID | None, project: Project
) -> None:
    """
    Builds the full project workspace — one row per pipeline stage, each
    with a sensible default responsible person (the project's own
    assignee), a staggered default due date, and whether it's one of the
    stages that needs an explicit approval before the project can move
    past it — plus a starter task checklist per stage. Called once, right
    after the brief approval that first advances the project past INTAKE
    (design_briefs/service.py::approve_brief); every field seeded here is
    immediately, freely editable.

    Guarded by `has_plan` at the call site (gated on advance_stage
    actually moving the project, same convention as
    projects/service.py::create_launch_tasks) so re-approving a brief —
    edit reverts it to draft, re-approve advances the same stage again —
    never rebuilds or duplicates an existing plan.
    """
    due = date.today()
    current_index = _STAGE_ORDER.index(project.stage)
    for index, stage in enumerate(_STAGE_ORDER):
        due = due + timedelta(days=_DEFAULT_DURATION_DAYS[stage])
        already_reached = current_index >= index
        requires_approval = stage in _REQUIRES_APPROVAL
        db.add(
            ProjectStagePlan(
                project_id=project.id,
                stage=stage,
                label=_LABELS[stage],
                sort_order=index,
                responsible_user_id=project.assigned_user_id,
                due_at=due,
                requires_approval=requires_approval,
                status=PlanStageStatus.DONE if already_reached else PlanStageStatus.PENDING,
                approved=already_reached and requires_approval,
                approved_by_user_id=actor_id if already_reached and requires_approval else None,
                approved_at=(
                    datetime.now(timezone.utc) if already_reached and requires_approval else None
                ),
            )
        )
        for title in _DEFAULT_STAGE_TASKS.get(stage, []):
            db.add(Task(project_id=project.id, stage=stage, title=title))
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="plan_created",
        summary="Project plan created — stages, tasks, deadlines, and approval points seeded",
    )


def get_plan(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> ProjectPlanRead | None:
    if _project_in_workspace(db, workspace_id, project_id) is None:
        return None

    stage_plans = db.scalars(
        select(ProjectStagePlan)
        .where(ProjectStagePlan.project_id == project_id)
        .order_by(ProjectStagePlan.sort_order)
        .options(
            joinedload(ProjectStagePlan.responsible_user), joinedload(ProjectStagePlan.approved_by_user)
        )
    ).all()
    counts = _task_counts(db, project_id)
    return ProjectPlanRead(
        project_id=project_id,
        stages=[_to_read(sp, *counts.get(sp.stage, (0, 0))) for sp in stage_plans],
    )


def update_stage(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, stage_plan_id: uuid.UUID, data: PlanStageUpdate
) -> PlanStageRead | None:
    stage_plan = _stage_plan_in_workspace(db, workspace_id, stage_plan_id)
    if stage_plan is None:
        return None

    fields = data.model_fields_set
    if "label" in fields and data.label is not None:
        stage_plan.label = data.label
    if "due_at" in fields:
        stage_plan.due_at = data.due_at
    if "requires_approval" in fields and data.requires_approval is not None:
        stage_plan.requires_approval = data.requires_approval
    if "status" in fields and data.status is not None:
        stage_plan.status = data.status
    if "responsible_user_id" in fields and data.responsible_user_id != stage_plan.responsible_user_id:
        if data.responsible_user_id is not None:
            require_user_in_workspace(db, workspace_id, data.responsible_user_id)
        stage_plan.responsible_user_id = data.responsible_user_id

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=stage_plan.project_id,
        action="plan_stage_updated",
        summary=f"{stage_plan.label} plan updated",
    )

    db.commit()
    stage_plan = _stage_plan_in_workspace(db, workspace_id, stage_plan_id)
    counts = _task_counts(db, stage_plan.project_id)
    return _to_read(stage_plan, *counts.get(stage_plan.stage, (0, 0)))


def approve_stage(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, stage_plan_id: uuid.UUID
) -> PlanStageRead | None:
    stage_plan = _stage_plan_in_workspace(db, workspace_id, stage_plan_id)
    if stage_plan is None:
        return None
    if not stage_plan.requires_approval:
        raise HTTPException(status_code=400, detail="This stage doesn't require an explicit approval")

    stage_plan.approved = True
    stage_plan.approved_by_user_id = actor_id
    stage_plan.approved_at = datetime.now(timezone.utc)
    stage_plan.status = PlanStageStatus.DONE

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=stage_plan.project_id,
        action="plan_stage_approved",
        summary=f"{stage_plan.label} approved",
    )

    db.commit()
    stage_plan = _stage_plan_in_workspace(db, workspace_id, stage_plan_id)
    counts = _task_counts(db, stage_plan.project_id)
    return _to_read(stage_plan, *counts.get(stage_plan.stage, (0, 0)))
