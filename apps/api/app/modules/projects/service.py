import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.clients.models import Client
from app.modules.projects.models import Project
from app.modules.projects.schemas import ProjectCreate, ProjectRead, ProjectUpdate


def _to_read(project: Project) -> ProjectRead:
    return ProjectRead(
        id=project.id,
        client_id=project.client_id,
        client_business_name=project.client.business.name,
        name=project.name,
        stage=project.stage,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _base_query():
    return select(Project).options(joinedload(Project.client).joinedload(Client.business))


def list_projects(db: Session) -> list[ProjectRead]:
    projects = db.scalars(_base_query().order_by(Project.created_at.desc()))
    return [_to_read(p) for p in projects]


def get_project(db: Session, project_id: uuid.UUID) -> ProjectRead | None:
    project = db.scalar(_base_query().where(Project.id == project_id))
    return _to_read(project) if project else None


def create_project(db: Session, data: ProjectCreate) -> ProjectRead:
    client = db.get(Client, data.client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")

    project = Project(client_id=data.client_id, name=data.name)
    db.add(project)
    db.commit()
    db.refresh(project)
    return get_project(db, project.id)  # reload with the joined client/business


def update_project(db: Session, project_id: uuid.UUID, data: ProjectUpdate) -> ProjectRead | None:
    project = db.get(Project, project_id)
    if project is None:
        return None
    project.stage = data.stage
    db.commit()
    return get_project(db, project_id)
