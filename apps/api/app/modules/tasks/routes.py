import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.tasks import service
from app.modules.tasks.schemas import TaskCreate, TaskRead, TaskUpdate
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskRead])
def list_tasks(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[TaskRead]:
    return service.list_tasks(db, current_user.workspace_id)


@router.post("", response_model=TaskRead, status_code=201)
def create_task(
    data: TaskCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> TaskRead:
    return service.create_task(db, current_user.workspace_id, current_user.id, data)


@router.get("/{task_id}", response_model=TaskRead)
def get_task(
    task_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> TaskRead:
    task = service.get_task(db, current_user.workspace_id, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    task_id: uuid.UUID,
    data: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TaskRead:
    task = service.update_task(db, current_user.workspace_id, current_user.id, task_id, data)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task
