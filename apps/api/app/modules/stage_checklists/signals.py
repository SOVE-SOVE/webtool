"""
Resolves each StageChecklistAutoSignal to a live done/changed-at/
completed-by/link result — read fresh on every request, never cached on
the checklist row itself (same discipline as checklists/signals.py). Used
two ways depending on a row's completion_mode:

- AUTOMATIC (Planning's "Approve the build brief", all 3 Project items):
  `done` fully determines the effective status every read.
- MANUAL with a signal set (everything else that has one): `done` is
  informational only — what matters is `completed_at`, the source's own
  last-changed timestamp, compared against the checklist item's own
  `completed_at` to decide whether a previously-completed manual review
  task should now show `needs_review` (see service.py::_to_read).

The 3 Project signals are thin wrappers around the *existing*
`checklists.signals.resolve` — same Website/QaReport rows, no duplicated
query logic.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.business_research.models import BusinessResearchResult
from app.modules.checklists import signals as client_checklist_signals
from app.modules.checklists.models import ChecklistAutoSignal
from app.modules.checklists.schemas import ChecklistCompletedBy, ChecklistLink
from app.modules.opportunity_scoring.models import OpportunityScoreResult
from app.modules.planning.models import LeadPlanning
from app.modules.sales_audits.models import SalesAuditReport
from app.modules.stage_checklists.models import StageChecklistAutoSignal
from app.modules.website_audits.models import WebsiteAudit
from app.modules.website_quality.models import WebsiteQualityAudit


@dataclass
class SignalResult:
    done: bool
    completed_at: object | None
    completed_by: ChecklistCompletedBy | None
    link: ChecklistLink | None


def _latest_at(*timestamps: object | None) -> object | None:
    present = [t for t in timestamps if t is not None]
    return max(present) if present else None


def _resolve_discovery_site_review(db: Session, discovered_business_id: uuid.UUID) -> SignalResult:
    research = db.scalar(
        select(BusinessResearchResult)
        .where(BusinessResearchResult.discovered_business_id == discovered_business_id)
        .order_by(BusinessResearchResult.researched_at.desc())
    )
    audit = db.scalar(
        select(WebsiteQualityAudit)
        .where(WebsiteQualityAudit.discovered_business_id == discovered_business_id)
        .order_by(WebsiteQualityAudit.audited_at.desc())
    )
    changed_at = _latest_at(research.researched_at if research else None, audit.audited_at if audit else None)
    return SignalResult(
        done=changed_at is not None,
        completed_at=changed_at,
        completed_by=ChecklistCompletedBy(type="system", via="Website/social research") if changed_at else None,
        link=ChecklistLink(label="Open research", href=f"/dashboard/discovered-businesses/{discovered_business_id}"),
    )


def _resolve_discovery_score(db: Session, discovered_business_id: uuid.UUID) -> SignalResult:
    score = db.scalar(
        select(OpportunityScoreResult)
        .where(OpportunityScoreResult.discovered_business_id == discovered_business_id)
        .order_by(OpportunityScoreResult.scored_at.desc())
    )
    return SignalResult(
        done=score is not None,
        completed_at=score.scored_at if score else None,
        completed_by=ChecklistCompletedBy(type="system", via="Opportunity score") if score else None,
        link=ChecklistLink(label="Open score", href=f"/dashboard/discovered-businesses/{discovered_business_id}"),
    )


def _resolve_lead_research(db: Session, lead_id: uuid.UUID) -> SignalResult:
    audit = db.scalar(select(WebsiteAudit).where(WebsiteAudit.lead_id == lead_id).order_by(WebsiteAudit.audited_at.desc()))
    sales_audit = db.scalar(
        select(SalesAuditReport).where(SalesAuditReport.lead_id == lead_id).order_by(SalesAuditReport.generated_at.desc())
    )
    changed_at = _latest_at(audit.audited_at if audit else None, sales_audit.generated_at if sales_audit else None)
    return SignalResult(
        done=changed_at is not None,
        completed_at=changed_at,
        completed_by=ChecklistCompletedBy(type="system", via="Website/sales audit") if changed_at else None,
        link=ChecklistLink(label="Open lead", href=f"/dashboard/leads/{lead_id}"),
    )


def _get_planning(db: Session, lead_planning_id: uuid.UUID) -> LeadPlanning | None:
    return db.get(LeadPlanning, lead_planning_id)


def _resolve_planning_audit(db: Session, lead_planning_id: uuid.UUID) -> SignalResult:
    planning = _get_planning(db, lead_planning_id)
    changed_at = planning.analysed_at if planning else None
    return SignalResult(
        done=changed_at is not None,
        completed_at=changed_at,
        completed_by=ChecklistCompletedBy(type="system", via="Website analysis") if changed_at else None,
        link=ChecklistLink(label="Open Planning", href=f"/dashboard/planning/{lead_planning_id}"),
    )


def _resolve_planning_review_insights(db: Session, lead_planning_id: uuid.UUID) -> SignalResult:
    planning = _get_planning(db, lead_planning_id)
    changed_at = planning.review_insights_generated_at if planning else None
    return SignalResult(
        done=changed_at is not None,
        completed_at=changed_at,
        completed_by=ChecklistCompletedBy(type="system", via="Google Review Insights") if changed_at else None,
        link=ChecklistLink(label="Open Planning", href=f"/dashboard/planning/{lead_planning_id}"),
    )


def _resolve_planning_recommendations(db: Session, lead_planning_id: uuid.UUID) -> SignalResult:
    planning = _get_planning(db, lead_planning_id)
    changed_at = planning.recommendations_generated_at if planning else None
    return SignalResult(
        done=changed_at is not None,
        completed_at=changed_at,
        completed_by=ChecklistCompletedBy(type="system", via="Improvement recommendations") if changed_at else None,
        link=ChecklistLink(label="Open Planning", href=f"/dashboard/planning/{lead_planning_id}"),
    )


def _resolve_planning_structure(db: Session, lead_planning_id: uuid.UUID) -> SignalResult:
    planning = _get_planning(db, lead_planning_id)
    changed_at = _latest_at(
        planning.sitemap_proposal_generated_at if planning else None,
        planning.visual_directions_generated_at if planning else None,
    )
    return SignalResult(
        done=changed_at is not None,
        completed_at=changed_at,
        completed_by=ChecklistCompletedBy(type="system", via="Sitemap/visual direction") if changed_at else None,
        link=ChecklistLink(label="Open Planning", href=f"/dashboard/planning/{lead_planning_id}"),
    )


def _resolve_planning_assets(db: Session, lead_planning_id: uuid.UUID) -> SignalResult:
    planning = _get_planning(db, lead_planning_id)
    changed_at = _latest_at(
        planning.assets_checklist_generated_at if planning else None,
        planning.content_draft_generated_at if planning else None,
    )
    return SignalResult(
        done=changed_at is not None,
        completed_at=changed_at,
        completed_by=ChecklistCompletedBy(type="system", via="Assets/content draft") if changed_at else None,
        link=ChecklistLink(label="Open Planning", href=f"/dashboard/planning/{lead_planning_id}"),
    )


def _resolve_planning_build_brief_approved(db: Session, lead_planning_id: uuid.UUID) -> SignalResult:
    planning = _get_planning(db, lead_planning_id)
    brief = planning.approved_brief if planning else None
    done = brief is not None
    return SignalResult(
        done=done,
        completed_at=brief.approved_at if done else None,
        completed_by=(
            ChecklistCompletedBy(type="system", name=brief.approved_by_user.name if brief.approved_by_user else None, via="Build brief approval")
            if done
            else None
        ),
        link=ChecklistLink(label="Open build brief", href=f"/dashboard/planning/{lead_planning_id}"),
    )


def _wrap_project_signal(client_signal: ChecklistAutoSignal):
    def _resolve(db: Session, project_id: uuid.UUID) -> SignalResult:
        r = client_checklist_signals.resolve(db, client_signal, project_id)
        return SignalResult(done=r.done, completed_at=r.completed_at, completed_by=r.completed_by, link=r.link)

    return _resolve


_RESOLVERS = {
    StageChecklistAutoSignal.DISCOVERY_SITE_REVIEW: _resolve_discovery_site_review,
    StageChecklistAutoSignal.DISCOVERY_SCORE: _resolve_discovery_score,
    StageChecklistAutoSignal.LEAD_RESEARCH: _resolve_lead_research,
    StageChecklistAutoSignal.PLANNING_AUDIT: _resolve_planning_audit,
    StageChecklistAutoSignal.PLANNING_REVIEW_INSIGHTS: _resolve_planning_review_insights,
    StageChecklistAutoSignal.PLANNING_RECOMMENDATIONS: _resolve_planning_recommendations,
    StageChecklistAutoSignal.PLANNING_STRUCTURE: _resolve_planning_structure,
    StageChecklistAutoSignal.PLANNING_ASSETS: _resolve_planning_assets,
    StageChecklistAutoSignal.PLANNING_BUILD_BRIEF_APPROVED: _resolve_planning_build_brief_approved,
    StageChecklistAutoSignal.PROJECT_PREVIEW_BUILT: _wrap_project_signal(ChecklistAutoSignal.PREVIEW_BUILT),
    StageChecklistAutoSignal.PROJECT_QA_COMPLETE: _wrap_project_signal(ChecklistAutoSignal.QA_COMPLETE),
    StageChecklistAutoSignal.PROJECT_LAUNCH_APPROVED: _wrap_project_signal(ChecklistAutoSignal.LAUNCH_APPROVED),
}


def resolve(db: Session, signal: StageChecklistAutoSignal, owner_id: uuid.UUID) -> SignalResult:
    return _RESOLVERS[signal](db, owner_id)


def resolve_all(
    db: Session, signals: set[StageChecklistAutoSignal], owner_id: uuid.UUID
) -> dict[StageChecklistAutoSignal, SignalResult]:
    return {signal: resolve(db, signal, owner_id) for signal in signals}
