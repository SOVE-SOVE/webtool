import uuid

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, aliased, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.leads.models import Lead
from app.modules.projects.models import Project
from app.modules.tasks.models import Task
from app.modules.tasks.schemas import TaskCreate, TaskRead, TaskUpdate
from app.modules.users.service import require_user_in_workspace

# Tasks belong to exactly one of project or lead, and each reaches the
# workspace via a different FK chain, so both paths are joined (outer,
# since only one side is ever populated) and matched with OR.
_ProjectBusiness = aliased(Business)
_LeadBusiness = aliased(Business)


def _context(task: Task) -> str:
    if task.project is not None:
        return f"Project: {task.project.name}"
    return f"Lead: {task.lead.business.name}"


def _to_read(task: Task) -> TaskRead:
    return TaskRead(
        id=task.id,
        title=task.title,
        done=task.done,
        due_at=task.due_at,
        project_id=task.project_id,
        lead_id=task.lead_id,
        assigned_user_id=task.assigned_user_id,
        assigned_user_name=task.assigned_user.name if task.assigned_user else None,
        stage=task.stage,
        context=_context(task),
        created_at=task.created_at,
    )


def _base_query(workspace_id: uuid.UUID):
    return (
        select(Task)
        .outerjoin(Project, Task.project_id == Project.id)
        .outerjoin(Client, Project.client_id == Client.id)
        .outerjoin(_ProjectBusiness, Client.business_id == _ProjectBusiness.id)
        .outerjoin(Lead, Task.lead_id == Lead.id)
        .outerjoin(_LeadBusiness, Lead.business_id == _LeadBusiness.id)
        .where(
            or_(
                _ProjectBusiness.workspace_id == workspace_id,
                _LeadBusiness.workspace_id == workspace_id,
            )
        )
        .options(
            joinedload(Task.project),
            joinedload(Task.lead).joinedload(Lead.business),
            joinedload(Task.assigned_user),
        )
    )


def list_tasks(db: Session, workspace_id: uuid.UUID) -> list[TaskRead]:
    tasks = db.scalars(_base_query(workspace_id).order_by(Task.done, Task.due_at.asc().nulls_last()))
    return [_to_read(t) for t in tasks]


def get_task(db: Session, workspace_id: uuid.UUID, task_id: uuid.UUID) -> TaskRead | None:
    task = db.scalar(_base_query(workspace_id).where(Task.id == task_id))
    return _to_read(task) if task else None


def _project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(Project.id)
            .join(Client, Project.client_id == Client.id)
            .join(Business, Client.business_id == Business.id)
            .where(Project.id == project_id, Business.workspace_id == workspace_id)
        )
        is not None
    )


def _lead_in_workspace(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(Lead.id)
            .join(Business, Lead.business_id == Business.id)
            .where(Lead.id == lead_id, Business.workspace_id == workspace_id)
        )
        is not None
    )


def create_task(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: TaskCreate
) -> TaskRead:
    if data.project_id is not None and not _project_in_workspace(db, workspace_id, data.project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    if data.lead_id is not None and not _lead_in_workspace(db, workspace_id, data.lead_id):
        raise HTTPException(status_code=404, detail="Lead not found")
    if data.assigned_user_id is not None:
        require_user_in_workspace(db, workspace_id, data.assigned_user_id)

    task = Task(
        title=data.title,
        due_at=data.due_at,
        project_id=data.project_id,
        lead_id=data.lead_id,
        assigned_user_id=data.assigned_user_id,
        stage=data.stage,
    )
    db.add(task)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="task",
        entity_id=task.id,
        action="created",
        summary=f"Created task {task.title}",
    )

    db.commit()
    return get_task(db, workspace_id, task.id)


def update_task(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, task_id: uuid.UUID, data: TaskUpdate
) -> TaskRead | None:
    task = db.scalar(_base_query(workspace_id).where(Task.id == task_id))
    if task is None:
        return None

    if data.done is not None and data.done != task.done:
        task.done = data.done
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="task",
            entity_id=task.id,
            action="completed" if data.done else "reopened",
            summary=task.title,
        )

    if "assigned_user_id" in data.model_fields_set and data.assigned_user_id != task.assigned_user_id:
        if data.assigned_user_id is not None:
            require_user_in_workspace(db, workspace_id, data.assigned_user_id)
        task.assigned_user_id = data.assigned_user_id
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="task",
            entity_id=task.id,
            action="assigned",
            summary="Unassigned" if data.assigned_user_id is None else "Reassigned",
        )

    if "stage" in data.model_fields_set:
        task.stage = data.stage

    db.commit()
    return get_task(db, workspace_id, task_id)
