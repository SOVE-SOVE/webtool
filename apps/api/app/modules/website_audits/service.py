import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.website_audit import WebsiteAuditOutput
from app.modules.businesses.models import Business
from app.modules.leads.models import Lead
from app.modules.website_audits.models import WebsiteAudit


def create_from_agent_output(db: Session, lead_id: uuid.UUID, output: WebsiteAuditOutput) -> WebsiteAudit:
    """
    Stages the row without committing — callers (sales_audits.service)
    commit as part of the larger generation transaction, same pattern as
    activity_log.service.record.
    """
    audit = WebsiteAudit(
        lead_id=lead_id,
        has_existing_site=output.has_existing_site,
        mobile_friendly=output.mobile_friendly,
        https=output.https,
        load_time_ms=output.load_time_ms,
        title=output.title,
        meta_description=output.meta_description,
        viewport_meta_present=output.viewport_meta_present,
        audit_error=output.audit_error,
    )
    db.add(audit)
    db.flush()  # assigns audit.id so a sales_audit_reports row can reference it
    return audit


def list_website_audits(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> list[WebsiteAudit]:
    query = (
        select(WebsiteAudit)
        .join(Lead, WebsiteAudit.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, WebsiteAudit.lead_id == lead_id)
        .order_by(WebsiteAudit.audited_at.desc())
    )
    return list(db.scalars(query))
