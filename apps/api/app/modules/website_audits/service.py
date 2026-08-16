import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents.website_audit import run as run_website_audit
from app.agents.website_audit_schemas import WebsiteAuditInput, WebsiteAuditOutput
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.leads.models import Lead
from app.modules.website_audits.models import WebsiteAudit, WebsiteAuditStatus
from app.modules.website_audits.schemas import WebsiteAuditRead


def _to_read(audit: WebsiteAudit) -> WebsiteAuditRead:
    return WebsiteAuditRead(
        id=audit.id,
        lead_id=audit.lead_id,
        url=audit.url,
        status=audit.status,
        has_existing_site=audit.has_existing_site,
        mobile_friendly=audit.mobile_friendly,
        https=audit.https,
        page_speed_score=audit.page_speed_score,
        flagged_for_review=audit.flagged_for_review,
        error=audit.error,
        report_markdown=audit.report_markdown,
        results=WebsiteAuditOutput.model_validate(audit.results_json),
        audited_at=audit.audited_at,
    )


def _get_lead(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
    return db.scalar(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(Lead.id == lead_id, Business.workspace_id == workspace_id)
        .options(joinedload(Lead.business))
    )


def list_audits(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> list[WebsiteAuditRead] | None:
    """Returns None (not an empty list) when the lead itself isn't found/visible, so routes.py can 404."""
    lead = _get_lead(db, workspace_id, lead_id)
    if lead is None:
        return None
    audits = db.scalars(
        select(WebsiteAudit).where(WebsiteAudit.lead_id == lead_id).order_by(WebsiteAudit.audited_at.desc())
    )
    return [_to_read(a) for a in audits]


def trigger_audit(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, lead_id: uuid.UUID
) -> WebsiteAuditRead:
    """
    Runs the audit engine synchronously — a v1 simplification (see
    docs/05_DECISIONS.md); a slow/unresponsive target site is bounded by
    the engine's own request timeouts, not by this call blocking
    indefinitely.
    """
    lead = _get_lead(db, workspace_id, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    url = lead.business.website_url
    if not url:
        raise HTTPException(status_code=422, detail="This lead's business has no website URL set")

    result = run_website_audit(WebsiteAuditInput(url=url))
    output = result.output

    if not output.reachable:
        status = WebsiteAuditStatus.BLOCKED if output.blocked else WebsiteAuditStatus.FAILED
    else:
        status = WebsiteAuditStatus.SUCCESS

    audit = WebsiteAudit(
        lead_id=lead_id,
        url=url,
        status=status,
        has_existing_site=output.reachable,
        mobile_friendly=output.mobile.viewport_present if output.reachable else None,
        https=output.technical.https if output.reachable else None,
        page_speed_score=output.performance.heuristic_speed_score if output.reachable else None,
        flagged_for_review=result.flagged_for_review,
        error=output.block_reason,
        results_json=output.model_dump(mode="json"),
        report_markdown=output.report_markdown,
    )
    db.add(audit)
    db.flush()

    summary = f"Audited {url} — HTTP {output.technical.http_status}" if output.reachable else f"Could not audit {url}: {output.block_reason}"
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead_id,
        action="website_audited",
        summary=summary,
    )

    db.commit()
    db.refresh(audit)
    return _to_read(audit)
