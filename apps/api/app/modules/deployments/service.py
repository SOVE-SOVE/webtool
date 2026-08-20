import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.approvals import service as approvals_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.deployments.models import Deployment
from app.modules.deployments.schemas import CreateDeploymentRequest, DeploymentRead
from app.modules.projects.models import Project
from app.modules.websites.models import Website

_READ_OPTIONS = (joinedload(Deployment.approved_by_user),)


def _latest_website(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Website | None:
    return db.scalar(
        select(Website)
        .join(Project, Website.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Website.project_id == project_id)
        .order_by(Website.generated_at.desc())
    )


def create_deployment(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID, request: CreateDeploymentRequest
) -> DeploymentRead | None:
    """
    Approval checkpoint 7 ("Final deployment"). Creating a row IS the
    approval record for this checkpoint — refuses outright (never
    silently proceeds) unless every prior checkpoint is currently
    approved, re-checked fresh here rather than trusting that an
    earlier gate already covered it (e.g. the brief could have been
    edited, reverting its own approval, after the website/QA/client
    review were approved — modules/approvals/service.py always reports
    each checkpoint's *current* state, not a cached one). No real
    hosting/publish action happens (`status` stays "pending") — roadmap
    M6, "do not add automatic deployment yet".
    """
    status = approvals_service.get_project_approval_status(db, workspace_id, project_id)
    if status is None:
        return None
    if not status.can_deploy:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot deploy — the following approvals are still missing: {', '.join(status.missing_for_deployment)}.",
        )

    website = _latest_website(db, workspace_id, project_id)
    assert website is not None  # can_deploy implies a website exists and is approved

    deployment = Deployment(
        website_id=website.id,
        environment=request.environment,
        status="pending",
        approved_by_user_id=actor_id,
        notes=request.notes,
    )
    db.add(deployment)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project_id,
        action="deployment_created",
        summary=f"Approved and recorded a {request.environment} deployment",
    )
    db.commit()
    return _to_read(deployment)


def _to_read(d: Deployment) -> DeploymentRead:
    return DeploymentRead(
        id=d.id,
        website_id=d.website_id,
        environment=d.environment,
        url=d.url,
        status=d.status,
        deployed_at=d.deployed_at,
        approved_by_user_name=d.approved_by_user.name if d.approved_by_user else None,
        notes=d.notes,
        created_at=d.created_at,
    )


def list_deployments(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> list[DeploymentRead]:
    deployments = db.scalars(
        select(Deployment)
        .join(Website, Deployment.website_id == Website.id)
        .join(Project, Website.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Website.project_id == project_id)
        .order_by(Deployment.created_at.desc())
        .options(*_READ_OPTIONS)
    ).unique()
    return [_to_read(d) for d in deployments]
