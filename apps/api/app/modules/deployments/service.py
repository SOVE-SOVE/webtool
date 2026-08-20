import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.integrations.deployment import DeploymentBundle, DeploymentProvider, get_deployment_provider
from app.modules.activity_log import service as activity_service
from app.modules.approvals import service as approvals_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.deployments.checks import run_predeploy_checks
from app.modules.deployments.models import Deployment
from app.modules.deployments.schemas import CreateDeploymentRequest, DeploymentRead, RollbackDeploymentRequest
from app.modules.design_briefs.models import DesignBrief
from app.modules.projects import service as projects_service
from app.modules.projects.models import Project, ProjectStage
from app.modules.qa_reports.models import QaReport
from app.modules.websites.models import Website, WebsiteStatus

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


def _get_brief(db: Session, project_id: uuid.UUID) -> DesignBrief | None:
    return db.scalar(select(DesignBrief).where(DesignBrief.project_id == project_id))


def _latest_qa_report(db: Session, website_id: uuid.UUID) -> QaReport | None:
    return db.scalar(select(QaReport).where(QaReport.website_id == website_id).order_by(QaReport.created_at.desc()))


def create_deployment(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID, request: CreateDeploymentRequest
) -> DeploymentRead | None:
    """
    Approval checkpoint 7 ("Final deployment") and deployment
    *preparation* — creating the row is the approval record, and this
    refuses outright (never silently proceeds) unless every prior
    checkpoint is currently approved, re-checked fresh here rather than
    trusting an earlier gate (modules/approvals/service.py always
    reports each checkpoint's *current* state). On top of the approval
    gate, `checks.run_predeploy_checks` verifies the specific approved
    version is actually safe to publish. The row starts `status="pending"`
    — nothing is actually published until `execute_deployment` runs.
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

    provider = get_deployment_provider()
    brief = _get_brief(db, project_id)
    latest_qa = _latest_qa_report(db, website.id)
    issues = run_predeploy_checks(website, brief, latest_qa, request.environment, provider.name)
    if issues:
        raise HTTPException(status_code=400, detail=f"Cannot deploy — pre-deployment checks failed: {'; '.join(issues)}.")

    deployment = Deployment(
        website_id=website.id,
        environment=request.environment,
        target=provider.name,
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
        action="deployment_prepared",
        summary=f"Approved and prepared a {request.environment} deployment (pending execution)",
    )

    project = db.get(Project, project_id)
    if project is not None:
        projects_service.advance_stage(
            db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.READY_TO_DEPLOY
        )

    db.commit()
    return _to_read(deployment)


def _get_deployment_in_workspace(db: Session, workspace_id: uuid.UUID, deployment_id: uuid.UUID) -> Deployment | None:
    return db.scalar(
        select(Deployment)
        .join(Website, Deployment.website_id == Website.id)
        .join(Project, Website.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Deployment.id == deployment_id)
        .options(*_READ_OPTIONS, joinedload(Deployment.website).joinedload(Website.project).joinedload(Project.client).joinedload(Client.business))
    )


def _run_provider(deployment: Deployment, provider: DeploymentProvider) -> None:
    """
    Mutates `deployment` in place with the outcome — pending -> running
    (in-memory only; a synchronous mock provider never leaves a
    persisted "running" row behind) -> success/failed. Never raises: a
    provider exception is caught and recorded as a failed deployment,
    same as an outcome the provider itself reports as not-ok, so a bug
    in a future real provider can't crash the request instead of
    cleanly failing the deployment.
    """
    deployment.status = "running"
    deployment.started_at = datetime.now(timezone.utc)

    website = deployment.website
    business = website.project.client.business
    bundle = DeploymentBundle(business_slug=business.name, environment=deployment.environment, config=website.config or {})

    try:
        outcome = provider.deploy(bundle)
    except Exception as exc:  # noqa: BLE001 — provider failures become a failed deployment, never a 500
        deployment.status = "failed"
        deployment.error_message = str(exc)
        deployment.completed_at = datetime.now(timezone.utc)
        return

    deployment.completed_at = datetime.now(timezone.utc)
    if outcome.ok:
        deployment.status = "success"
        deployment.url = outcome.url
        deployment.result = outcome.detail
        deployment.deployed_at = deployment.completed_at
        website.status = WebsiteStatus.LIVE
    else:
        deployment.status = "failed"
        deployment.error_message = outcome.error or "Deployment failed for an unknown reason"


def execute_deployment(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, deployment_id: uuid.UUID) -> DeploymentRead | None:
    """
    Runs the prepared deployment through the configured provider
    (mock today — see integrations/deployment.py). Only a `pending` or
    previously-`failed` deployment can be (re-)executed; a `success`ful
    one is immutable history, and re-running a `running` one isn't
    supported.
    """
    deployment = _get_deployment_in_workspace(db, workspace_id, deployment_id)
    if deployment is None:
        return None

    # Row lock, not a plain read: without it two requests arriving
    # together both see "pending" and both publish the same deployment.
    # The lock is held until this transaction commits, so the loser
    # re-reads the winner's final status and is refused.
    current_status = db.execute(
        select(Deployment.status).where(Deployment.id == deployment.id).with_for_update()
    ).scalar_one()
    if current_status not in ("pending", "failed"):
        raise HTTPException(status_code=400, detail=f"Cannot execute a deployment that is already '{current_status}'.")

    provider = get_deployment_provider()
    _run_provider(deployment, provider)

    project = deployment.website.project
    if deployment.status == "success":
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=project.id,
            action="deployment_succeeded",
            summary=f"Deployed to {deployment.environment} via {deployment.target}: {deployment.url}",
        )
        projects_service.advance_stage(
            db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.DEPLOYED
        )
    else:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=project.id,
            action="deployment_failed",
            summary=f"Deployment to {deployment.environment} failed: {deployment.error_message}",
        )

    db.commit()
    return _to_read(deployment)


def rollback_deployment(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID, request: RollbackDeploymentRequest
) -> DeploymentRead | None:
    """
    Version selection: re-publishes an earlier website version by
    re-running a *previously successful* deployment of it — never an
    arbitrary or unapproved one. `target_deployment_id`'s own website
    row carries its own approval/QA/client-review flags (per-version,
    not just "latest"), which are re-checked here rather than trusted
    from the past, same "do not bypass the approval system for
    convenience" contract as `create_deployment`.
    """
    if _latest_website(db, workspace_id, project_id) is None:
        return None

    target = _get_deployment_in_workspace(db, workspace_id, request.target_deployment_id)
    if target is None or target.website.project_id != project_id:
        raise HTTPException(status_code=404, detail="No prior deployment with that id exists for this project")
    if target.status != "success":
        raise HTTPException(status_code=400, detail="Can only roll back to a deployment that previously succeeded")

    website = target.website
    latest_qa = _latest_qa_report(db, website.id)
    missing = []
    if not website.approved:
        missing.append("generated website")
    if not website.client_approved:
        missing.append("client review")
    if latest_qa is None or not latest_qa.human_approved:
        missing.append("QA")
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot roll back to this version — its own approvals are no longer intact: {', '.join(missing)}.",
        )

    provider = get_deployment_provider()
    deployment = Deployment(
        website_id=website.id,
        environment=target.environment,
        target=provider.name,
        status="pending",
        approved_by_user_id=actor_id,
        notes=request.notes or f"Rollback to the {target.environment} deployment from {target.created_at.isoformat()}",
        rollback_of_deployment_id=target.id,
    )
    db.add(deployment)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project_id,
        action="deployment_rollback_initiated",
        summary=f"Rolling back {target.environment} to an earlier deployed version",
    )

    _run_provider(deployment, provider)

    project = website.project
    if deployment.status == "success":
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=project_id,
            action="deployment_succeeded",
            summary=f"Rolled back and redeployed to {deployment.environment}: {deployment.url}",
        )
        projects_service.advance_stage(
            db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.DEPLOYED
        )
    else:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=project_id,
            action="deployment_failed",
            summary=f"Rollback deployment failed: {deployment.error_message}",
        )

    db.commit()
    return _to_read(deployment)


def _to_read(d: Deployment) -> DeploymentRead:
    return DeploymentRead(
        id=d.id,
        website_id=d.website_id,
        environment=d.environment,
        target=d.target,
        url=d.url,
        status=d.status,
        result=d.result,
        error_message=d.error_message,
        started_at=d.started_at,
        completed_at=d.completed_at,
        deployed_at=d.deployed_at,
        rollback_of_deployment_id=d.rollback_of_deployment_id,
        approved_by_user_name=d.approved_by_user.name if d.approved_by_user else None,
        notes=d.notes,
        created_at=d.created_at,
    )


def get_deployment(db: Session, workspace_id: uuid.UUID, deployment_id: uuid.UUID) -> DeploymentRead | None:
    deployment = _get_deployment_in_workspace(db, workspace_id, deployment_id)
    return _to_read(deployment) if deployment else None


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
