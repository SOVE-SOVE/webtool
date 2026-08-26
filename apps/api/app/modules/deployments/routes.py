import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.deployments import service
from app.modules.deployments.schemas import CreateDeploymentRequest, DeploymentRead, RollbackDeploymentRequest
from app.modules.projects import service as projects_service
from app.modules.users.models import User

router = APIRouter(tags=["deployments"])


@router.post("/api/v1/projects/{project_id}/deployments", response_model=DeploymentRead, status_code=201)
def create_deployment(
    project_id: uuid.UUID,
    body: CreateDeploymentRequest = CreateDeploymentRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeploymentRead:
    deployment = service.create_deployment(db, current_user.workspace_id, current_user.id, project_id, body)
    if deployment is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return deployment


@router.get("/api/v1/projects/{project_id}/deployments", response_model=list[DeploymentRead])
def list_deployments(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DeploymentRead]:
    if projects_service.get_project(db, current_user.workspace_id, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return service.list_deployments(db, current_user.workspace_id, project_id)


@router.get("/api/v1/deployments/{deployment_id}", response_model=DeploymentRead)
def get_deployment(
    deployment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeploymentRead:
    deployment = service.get_deployment(db, current_user.workspace_id, deployment_id)
    if deployment is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment


@router.post("/api/v1/deployments/{deployment_id}/execute", response_model=DeploymentRead)
def execute_deployment(
    deployment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeploymentRead:
    deployment = service.execute_deployment(db, current_user.workspace_id, current_user.id, deployment_id)
    if deployment is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment


@router.post("/api/v1/projects/{project_id}/deployments/rollback", response_model=DeploymentRead, status_code=201)
def rollback_deployment(
    project_id: uuid.UUID,
    body: RollbackDeploymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeploymentRead:
    deployment = service.rollback_deployment(db, current_user.workspace_id, current_user.id, project_id, body)
    if deployment is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return deployment


@router.post("/api/v1/deployments/{deployment_id}/check-status", response_model=DeploymentRead)
def check_deployment_status(
    deployment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeploymentRead:
    """The "monitor deployment" step — re-reads the provider's own
    state for a previously submitted deployment. See service docstring
    for why this is a no-op refresh for most providers today."""
    deployment = service.check_deployment_status(db, current_user.workspace_id, deployment_id)
    if deployment is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment


@router.post("/api/v1/deployments/{deployment_id}/verify", response_model=DeploymentRead)
def verify_deployment(
    deployment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeploymentRead:
    """The "verify deployment" handover step — confirms the published
    URL is actually live before a project can be marked delivered."""
    deployment = service.verify_deployment(db, current_user.workspace_id, current_user.id, deployment_id)
    if deployment is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment
