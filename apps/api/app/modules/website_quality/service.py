import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import website_quality as website_quality_agent
from app.agents.website_quality import WebsiteQualityInput
from app.modules.activity_log import service as activity_service
from app.modules.business_research.models import BusinessResearchResult
from app.modules.discovery.models import DiscoveredBusiness, DiscoveredBusinessStatus, DiscoverySearch
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import JOB_OPPORTUNITY_SCORE
from app.modules.website_quality.models import WebsiteQualityAudit
from app.modules.website_quality.schemas import WebsiteQualityAuditRead

# A discovered business's status only moves forward through this set on
# an audit — WON'T regress APPROVED/REJECTED/ARCHIVED/IMPORTED, same
# "only advance a status that's genuinely behind" contract as
# leads/service.py's mark_researched/mark_contacted.
_PRE_AUDIT_STATUSES = (DiscoveredBusinessStatus.NEW, DiscoveredBusinessStatus.RESEARCHED)


class NoResearchAvailableError(ValueError):
    """Raised when a quality audit is requested before any research
    exists for the business — see run_quality_audit."""


def _get_discovered_business(
    db: Session, workspace_id: uuid.UUID, discovered_business_id: uuid.UUID
) -> DiscoveredBusiness | None:
    return db.scalar(
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id == discovered_business_id)
    )


def _get_latest_research(db: Session, discovered_business_id: uuid.UUID) -> BusinessResearchResult | None:
    return db.scalar(
        select(BusinessResearchResult)
        .where(BusinessResearchResult.discovered_business_id == discovered_business_id)
        .order_by(BusinessResearchResult.researched_at.desc())
        .limit(1)
    )


def run_quality_audit(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, discovered_business_id: uuid.UUID
) -> WebsiteQualityAuditRead | None:
    """Returns None (route 404s) when the business doesn't exist in this
    workspace; raises NoResearchAvailableError (route 400s) when it
    exists but has never been researched — an audit needs research's
    signals, it doesn't fetch the site itself."""
    business = _get_discovered_business(db, workspace_id, discovered_business_id)
    if business is None:
        return None

    research = _get_latest_research(db, discovered_business_id)
    if research is None:
        raise NoResearchAvailableError("No research available for this business yet — run research first")

    result = website_quality_agent.run(
        WebsiteQualityInput(
            website_reachable=research.website_reachable,
            research_error=research.research_error,
            https=research.https,
            mobile_viewport_present=research.mobile_viewport_present,
            load_time_ms=research.load_time_ms,
            contact_cta_present=research.contact_cta_present,
            page_title=research.page_title,
            meta_description=research.meta_description,
            appears_template_or_placeholder=research.appears_template_or_placeholder,
        )
    )
    output = result.output
    findings = [f.model_dump() for f in output.findings]
    critical_count = sum(1 for f in output.findings if f.severity == "critical")

    audit = WebsiteQualityAudit(
        discovered_business_id=business.id,
        business_research_id=research.id,
        findings=findings,
        summary=output.summary,
        issue_count=len(findings),
        critical_count=critical_count,
    )
    db.add(audit)
    db.flush()

    if business.status in _PRE_AUDIT_STATUSES:
        business.status = DiscoveredBusinessStatus.AUDITED

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovered_business",
        entity_id=business.id,
        action="quality_audited",
        summary=f"Website quality audit for {business.name}: {output.summary}",
    )

    db.commit()
    db.refresh(audit)

    # Automation hand-off: scoring runs next on its own.
    jobs_service.enqueue(
        db,
        workspace_id=workspace_id,
        job_type=JOB_OPPORTUNITY_SCORE,
        payload={"discovered_business_id": str(business.id)},
        actor_id=actor_id,
    )

    return WebsiteQualityAuditRead.model_validate(audit)


def list_quality_audits(db: Session, discovered_business_id: uuid.UUID) -> list[WebsiteQualityAuditRead]:
    query = (
        select(WebsiteQualityAudit)
        .where(WebsiteQualityAudit.discovered_business_id == discovered_business_id)
        .order_by(WebsiteQualityAudit.audited_at.desc())
    )
    return [WebsiteQualityAuditRead.model_validate(a) for a in db.scalars(query)]
