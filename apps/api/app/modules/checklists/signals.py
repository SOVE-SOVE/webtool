"""
Resolves each ChecklistAutoSignal to a live done/completed_at/
completed_by/link result for one project — read fresh on every request,
never cached on the checklist row itself. This is what makes "if a
linked approval is revoked, show the task needs attention again" free:
there's no stored boolean to go stale, only a live read of the same
underlying records `approvals/service.py::get_project_approval_status`
already reads (the query shapes are intentionally mirrored, not
imported, to keep this module independent of that one's internals —
same one-line-of-duplication tradeoff that module itself already
accepts against creative_directions/sitemaps/websites).
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.checklists.models import ChecklistAutoSignal
from app.modules.checklists.schemas import ChecklistCompletedBy, ChecklistLink
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.deployments.models import Deployment
from app.modules.design_briefs.models import BriefStatus, DesignBrief
from app.modules.qa_reports.models import QaReport
from app.modules.sitemaps.models import Sitemap, SitemapStatus
from app.modules.websites.models import Website


@dataclass
class SignalResult:
    done: bool
    completed_at: object | None
    completed_by: ChecklistCompletedBy | None
    link: ChecklistLink | None


def _latest_website(db: Session, project_id: uuid.UUID) -> Website | None:
    return db.scalar(select(Website).where(Website.project_id == project_id).order_by(Website.generated_at.desc()))


def _latest_qa_report(db: Session, website_id: uuid.UUID) -> QaReport | None:
    return db.scalar(select(QaReport).where(QaReport.website_id == website_id).order_by(QaReport.created_at.desc()))


def _latest_deployment(db: Session, website_id: uuid.UUID) -> Deployment | None:
    return db.scalar(
        select(Deployment).where(Deployment.website_id == website_id).order_by(Deployment.created_at.desc())
    )


def _website_href(project_id: uuid.UUID, tab: str) -> str:
    return f"/dashboard/projects/{project_id}/website?tab={tab}"


def _resolve_website_scope_confirmed(db: Session, project_id: uuid.UUID) -> SignalResult:
    brief = db.scalar(select(DesignBrief).where(DesignBrief.project_id == project_id))
    done = brief is not None and brief.status == BriefStatus.APPROVED
    return SignalResult(
        done=done,
        completed_at=brief.approved_at if done else None,
        completed_by=(
            ChecklistCompletedBy(type="system", name=brief.approved_by_user.name if brief.approved_by_user else None, via="Client brief approval")
            if done
            else None
        ),
        link=ChecklistLink(label="Open client brief", href=f"/dashboard/projects/{project_id}"),
    )


def _resolve_direction_approved(db: Session, project_id: uuid.UUID) -> SignalResult:
    cd = db.scalar(
        select(CreativeDirectionBrief)
        .where(CreativeDirectionBrief.project_id == project_id)
        .order_by(CreativeDirectionBrief.generated_at.desc())
    )
    done = cd is not None and cd.status == CreativeDirectionStatus.APPROVED
    return SignalResult(
        done=done,
        completed_at=cd.approved_at if done else None,
        completed_by=(
            ChecklistCompletedBy(type="system", name=cd.approved_by_user.name if cd.approved_by_user else None, via="Creative direction approval")
            if done
            else None
        ),
        link=ChecklistLink(label="Open creative direction", href=_website_href(project_id, "approval")),
    )


def _resolve_content_approved(db: Session, project_id: uuid.UUID) -> SignalResult:
    sitemap = db.scalar(select(Sitemap).where(Sitemap.project_id == project_id).order_by(Sitemap.generated_at.desc()))
    done = sitemap is not None and sitemap.status == SitemapStatus.APPROVED
    return SignalResult(
        done=done,
        completed_at=sitemap.approved_at if done else None,
        completed_by=(
            ChecklistCompletedBy(type="system", name=sitemap.approved_by_user.name if sitemap.approved_by_user else None, via="Sitemap approval")
            if done
            else None
        ),
        link=ChecklistLink(label="Open sitemap", href=_website_href(project_id, "content")),
    )


def _resolve_preview_built(db: Session, project_id: uuid.UUID) -> SignalResult:
    website = _latest_website(db, project_id)
    done = website is not None
    return SignalResult(
        done=done,
        completed_at=website.generated_at if done else None,
        completed_by=ChecklistCompletedBy(type="system", via="Website generated") if done else None,
        link=ChecklistLink(label="Open preview", href=_website_href(project_id, "preview")),
    )


def _resolve_qa_complete(db: Session, project_id: uuid.UUID) -> SignalResult:
    website = _latest_website(db, project_id)
    qa = _latest_qa_report(db, website.id) if website else None
    done = qa is not None and qa.human_approved
    return SignalResult(
        done=done,
        completed_at=qa.approved_at if done else None,
        completed_by=(
            ChecklistCompletedBy(type="system", name=qa.approved_by_user.name if qa.approved_by_user else None, via="QA sign-off")
            if done
            else None
        ),
        link=ChecklistLink(label="Open QA report", href=_website_href(project_id, "qa")),
    )


def _resolve_launch_approved(db: Session, project_id: uuid.UUID) -> SignalResult:
    website = _latest_website(db, project_id)
    done = website is not None and website.client_approved
    return SignalResult(
        done=done,
        completed_at=website.client_approved_at if done else None,
        completed_by=(
            ChecklistCompletedBy(
                type="system",
                name=website.client_approved_by_user.name if website.client_approved_by_user else None,
                via="Client review approval",
            )
            if done
            else None
        ),
        link=ChecklistLink(label="Open client review", href=_website_href(project_id, "approval")),
    )


def _resolve_website_launched(db: Session, project_id: uuid.UUID) -> SignalResult:
    website = _latest_website(db, project_id)
    deployment = _latest_deployment(db, website.id) if website else None
    done = deployment is not None and deployment.status == "success" and deployment.verified_at is not None
    return SignalResult(
        done=done,
        completed_at=deployment.verified_at if done else None,
        completed_by=(
            ChecklistCompletedBy(
                type="system", name=deployment.verified_by_user.name if deployment.verified_by_user else None, via="Verified deployment"
            )
            if done
            else None
        ),
        link=ChecklistLink(label="Open deployment", href=_website_href(project_id, "deployment")),
    )


_RESOLVERS = {
    ChecklistAutoSignal.WEBSITE_SCOPE_CONFIRMED: _resolve_website_scope_confirmed,
    ChecklistAutoSignal.DIRECTION_APPROVED: _resolve_direction_approved,
    ChecklistAutoSignal.CONTENT_APPROVED: _resolve_content_approved,
    ChecklistAutoSignal.PREVIEW_BUILT: _resolve_preview_built,
    ChecklistAutoSignal.QA_COMPLETE: _resolve_qa_complete,
    ChecklistAutoSignal.LAUNCH_APPROVED: _resolve_launch_approved,
    ChecklistAutoSignal.WEBSITE_LAUNCHED: _resolve_website_launched,
}


def resolve(db: Session, signal: ChecklistAutoSignal, project_id: uuid.UUID) -> SignalResult:
    return _RESOLVERS[signal](db, project_id)


def resolve_all(db: Session, signals: set[ChecklistAutoSignal], project_id: uuid.UUID) -> dict[ChecklistAutoSignal, SignalResult]:
    return {signal: resolve(db, signal, project_id) for signal in signals}
