import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.leads.models import Lead
from app.modules.projects.models import Project
from app.modules.tasks.models import Task
from app.modules.tasks.schemas import TaskCreate, TaskRead, TaskUpdate


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
        context=_context(task),
        created_at=task.created_at,
    )


def _base_query():
    return select(Task).options(
        joinedload(Task.project), joinedload(Task.lead).joinedload(Lead.business)
    )


def list_tasks(db: Session) -> list[TaskRead]:
    tasks = db.scalars(_base_query().order_by(Task.done, Task.due_at.asc().nulls_last()))
    return [_to_read(t) for t in tasks]


def get_task(db: Session, task_id: uuid.UUID) -> TaskRead | None:
    task = db.scalar(_base_query().where(Task.id == task_id))
    return _to_read(task) if task else None


def create_task(db: Session, data: TaskCreate) -> TaskRead:
    if data.project_id is not None and db.get(Project, data.project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if data.lead_id is not None and db.get(Lead, data.lead_id) is None:
        raise HTTPException(status_code=404, detail="Lead not found")

    task = Task(title=data.title, due_at=data.due_at, project_id=data.project_id, lead_id=data.lead_id)
    db.add(task)
    db.commit()
    return get_task(db, task.id)


def update_task(db: Session, task_id: uuid.UUID, data: TaskUpdate) -> TaskRead | None:
    task = db.get(Task, task_id)
    if task is None:
        return None
    task.done = data.done
    db.commit()
    return get_task(db, task_id)
