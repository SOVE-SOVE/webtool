import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.projects.models import Project
from app.modules.projects.schemas import ProjectCreate, ProjectRead, ProjectUpdate
from app.modules.users.service import require_user_in_workspace


def _to_read(project: Project) -> ProjectRead:
    return ProjectRead(
        id=project.id,
        client_id=project.client_id,
        client_business_name=project.client.business.name,
        name=project.name,
        stage=project.stage,
        assigned_user_id=project.assigned_user_id,
        assigned_user_name=project.assigned_user.name if project.assigned_user else None,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _base_query(workspace_id: uuid.UUID):
    return (
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(
            joinedload(Project.client).joinedload(Client.business), joinedload(Project.assigned_user)
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

    project = Project(client_id=data.client_id, name=data.name, assigned_user_id=data.assigned_user_id)
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
        project.stage = data.stage

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
