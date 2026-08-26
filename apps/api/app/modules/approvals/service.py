import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.approvals.schemas import ApprovalCheckpoint, ProjectApprovalStatus
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.deployments.models import Deployment
from app.modules.design_briefs.models import BriefStatus, DesignBrief
from app.modules.projects.models import Project
from app.modules.qa_reports.models import QaReport
from app.modules.sitemaps.models import Sitemap, SitemapStatus
from app.modules.websites import service as websites_service
from app.modules.websites.models import Website

# One line of duplication with modules/websites/service.py's own
# resolvers — accepted, same convention creative_directions/sitemaps/
# websites already each tolerate for their own "latest row for this
# project" queries, since the alternative (a shared cross-module helper
# module) would couple all of them together for a handful of lines.


def _project_exists(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(Project.id)
            .join(Client, Project.client_id == Client.id)
            .join(Business, Client.business_id == Business.id)
            .where(Business.workspace_id == workspace_id, Project.id == project_id)
        )
        is not None
    )


def _latest_creative_direction(db: Session, project_id: uuid.UUID) -> CreativeDirectionBrief | None:
    return db.scalar(
        select(CreativeDirectionBrief)
        .where(CreativeDirectionBrief.project_id == project_id)
        .order_by(CreativeDirectionBrief.generated_at.desc())
    )


def _latest_sitemap(db: Session, project_id: uuid.UUID) -> Sitemap | None:
    return db.scalar(select(Sitemap).where(Sitemap.project_id == project_id).order_by(Sitemap.generated_at.desc()))


def _latest_website(db: Session, project_id: uuid.UUID) -> Website | None:
    return db.scalar(select(Website).where(Website.project_id == project_id).order_by(Website.generated_at.desc()))


def _latest_qa_report(db: Session, website_id: uuid.UUID) -> QaReport | None:
    return db.scalar(select(QaReport).where(QaReport.website_id == website_id).order_by(QaReport.created_at.desc()))


def _latest_deployment(db: Session, website_id: uuid.UUID) -> Deployment | None:
    return db.scalar(
        select(Deployment).where(Deployment.website_id == website_id).order_by(Deployment.created_at.desc())
    )


def get_project_approval_status(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> ProjectApprovalStatus | None:
    if not _project_exists(db, workspace_id, project_id):
        return None

    checkpoints: list[ApprovalCheckpoint] = []

    brief = db.scalar(select(DesignBrief).where(DesignBrief.project_id == project_id))
    brief_approved = brief is not None and brief.status == BriefStatus.APPROVED
    checkpoints.append(
        ApprovalCheckpoint(
            stage="client_brief",
            label="Client brief",
            approved=brief_approved,
            approved_by_user_name=brief.approved_by_user.name if brief and brief.approved_by_user else None,
            approved_at=brief.approved_at if brief else None,
            version_label="Current brief" if brief else None,
            notes=None,
            blocked_reason=None if brief_approved else ("No client brief started yet" if brief is None else "Brief not approved yet"),
        )
    )

    cd = _latest_creative_direction(db, project_id)
    cd_approved = cd is not None and cd.status == CreativeDirectionStatus.APPROVED
    checkpoints.append(
        ApprovalCheckpoint(
            stage="creative_direction",
            label="Creative direction",
            approved=cd_approved,
            approved_by_user_name=cd.approved_by_user.name if cd and cd.approved_by_user else None,
            approved_at=cd.approved_at if cd else None,
            version_label=f"Generated {cd.generated_at.date().isoformat()}" if cd else None,
            notes=None,
            blocked_reason=None if cd_approved else ("No creative direction generated yet" if cd is None else "Latest creative direction not approved yet"),
        )
    )

    sitemap = _latest_sitemap(db, project_id)
    sitemap_approved = sitemap is not None and sitemap.status == SitemapStatus.APPROVED
    checkpoints.append(
        ApprovalCheckpoint(
            stage="sitemap",
            label="Sitemap",
            approved=sitemap_approved,
            approved_by_user_name=sitemap.approved_by_user.name if sitemap and sitemap.approved_by_user else None,
            approved_at=sitemap.approved_at if sitemap else None,
            version_label=f"Generated {sitemap.generated_at.date().isoformat()}" if sitemap else None,
            notes=None,
            blocked_reason=None if sitemap_approved else ("No sitemap generated yet" if sitemap is None else "Latest sitemap not approved yet"),
        )
    )

    website = _latest_website(db, project_id)
    website_approved = website is not None and website.approved
    checkpoints.append(
        ApprovalCheckpoint(
            stage="generated_website",
            label="Generated website",
            approved=website_approved,
            approved_by_user_name=website.approved_by_user.name if website and website.approved_by_user else None,
            approved_at=website.approved_at if website else None,
            version_label=f"Generated {website.generated_at.date().isoformat()}" if website else None,
            notes=website.approval_notes if website else None,
            blocked_reason=None if website_approved else ("No website generated yet" if website is None else "Latest website version not approved yet"),
        )
    )

    qa = _latest_qa_report(db, website.id) if website else None
    qa_approved = qa is not None and qa.human_approved
    checkpoints.append(
        ApprovalCheckpoint(
            stage="qa",
            label="QA",
            approved=qa_approved,
            approved_by_user_name=qa.approved_by_user.name if qa and qa.approved_by_user else None,
            approved_at=qa.approved_at if qa else None,
            version_label=f"Run {qa.created_at.date().isoformat()}" if qa else None,
            notes=qa.approval_notes if qa else None,
            blocked_reason=None
            if qa_approved
            else ("No QA report run yet" if qa is None else ("QA report has unresolved critical issues" if not qa.passed else "QA report not approved yet")),
        )
    )

    client_review_approved = website is not None and website.client_approved
    checkpoints.append(
        ApprovalCheckpoint(
            stage="client_review",
            label="Client review",
            approved=client_review_approved,
            approved_by_user_name=website.client_approved_by_user.name if website and website.client_approved_by_user else None,
            approved_at=website.client_approved_at if website else None,
            version_label=f"Generated {website.generated_at.date().isoformat()}" if website else None,
            notes=website.client_approval_notes if website else None,
            blocked_reason=None if client_review_approved else "Client has not approved this version yet",
        )
    )

    deployment = _latest_deployment(db, website.id) if website else None
    deployment_approved = deployment is not None
    checkpoints.append(
        ApprovalCheckpoint(
            stage="deployment",
            label="Final deployment",
            approved=deployment_approved,
            approved_by_user_name=deployment.approved_by_user.name if deployment and deployment.approved_by_user else None,
            approved_at=deployment.created_at if deployment else None,
            version_label=f"{deployment.environment}" if deployment else None,
            notes=deployment.notes if deployment else None,
            blocked_reason=None if deployment_approved else "Not deployed yet",
        )
    )

    prerequisite_checkpoints = checkpoints[:6]  # every stage except deployment itself
    missing_for_deployment = [c.label for c in prerequisite_checkpoints if not c.approved]

    # Phase 6 Task 3's formal workflow is a gate `create_deployment`
    # enforces independently of these seven boolean checkpoints — a
    # version can have every one of them set yet never have been walked
    # through the workflow at all. Folded into `can_deploy` here too, so
    # this endpoint's answer never disagrees with what a deploy attempt
    # will actually do (see modules/websites/service.py's
    # is_ready_to_deploy, the single shared source of truth both read).
    # Only surfaced once the six above are otherwise satisfied — while
    # any of *those* is still missing, that's the real blocker to report,
    # not "also do the formal workflow" noise on top of it.
    workflow_ready = website is not None and websites_service.is_ready_to_deploy(website)
    if not missing_for_deployment and not workflow_ready:
        missing_for_deployment.append("Approval workflow (not yet ready to deploy)")
    can_deploy = not missing_for_deployment and workflow_ready

    return ProjectApprovalStatus(
        project_id=project_id,
        checkpoints=checkpoints,
        can_deploy=can_deploy,
        missing_for_deployment=missing_for_deployment,
    )
