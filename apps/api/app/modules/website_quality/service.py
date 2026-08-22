import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.website_quality.models import WebsiteQualityAudit
from app.modules.website_quality.schemas import WebsiteQualityAuditRead


def list_quality_audits(db: Session, discovered_business_id: uuid.UUID) -> list[WebsiteQualityAuditRead]:
    query = (
        select(WebsiteQualityAudit)
        .where(WebsiteQualityAudit.discovered_business_id == discovered_business_id)
        .order_by(WebsiteQualityAudit.audited_at.desc())
    )
    return [WebsiteQualityAuditRead.model_validate(a) for a in db.scalars(query)]
