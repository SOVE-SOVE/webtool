import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents.lead_score import run as run_lead_score
from app.agents.lead_score_schemas import LeadScoreInput, LeadScoreOutput
from app.agents.website_audit_schemas import WebsiteAuditOutput
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.lead_scores.models import LeadScore
from app.modules.lead_scores.schemas import LeadScoreRead
from app.modules.leads.models import Lead
from app.modules.website_audits.models import WebsiteAudit


def _to_read(score: LeadScore) -> LeadScoreRead:
    return LeadScoreRead(
        id=score.id,
        lead_id=score.lead_id,
        based_on_audit_id=score.based_on_audit_id,
        overall_score=score.overall_score,
        confidence=score.confidence,
        config_version=score.config_version,
        flagged_for_review=score.flagged_for_review,
        results=LeadScoreOutput.model_validate(score.results_json),
        scored_at=score.scored_at,
    )


def _get_lead(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
    return db.scalar(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(Lead.id == lead_id, Business.workspace_id == workspace_id)
        .options(joinedload(Lead.business))
    )


def _latest_audit(db: Session, lead_id: uuid.UUID) -> WebsiteAudit | None:
    return db.scalar(
        select(WebsiteAudit).where(WebsiteAudit.lead_id == lead_id).order_by(WebsiteAudit.audited_at.desc())
    )


def list_scores(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> list[LeadScoreRead] | None:
    """Returns None (not an empty list) when the lead itself isn't found/visible, so routes.py can 404."""
    lead = _get_lead(db, workspace_id, lead_id)
    if lead is None:
        return None
    scores = db.scalars(
        select(LeadScore).where(LeadScore.lead_id == lead_id).order_by(LeadScore.scored_at.desc())
    )
    return [_to_read(s) for s in scores]


def trigger_score(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, lead_id: uuid.UUID
) -> LeadScoreRead:
    """
    Runs the scoring engine against the lead's current business record
    and most recent website audit (if any). Always inserts a new row —
    never overwrites a previous score — so score history is preserved
    even as later audits change the picture. See docs/05_DECISIONS.md.
    """
    lead = _get_lead(db, workspace_id, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")

    audit = _latest_audit(db, lead_id)
    audit_output = WebsiteAuditOutput.model_validate(audit.results_json) if audit else None

    business = lead.business
    score_input = LeadScoreInput(
        industry=business.industry,
        suburb=business.suburb,
        state=business.state,
        phone=business.phone,
        email=business.email,
        social_links=business.social_links,
        abn=business.abn,
        website_url=business.website_url,
        audit=audit_output,
        audit_flagged_for_review=audit.flagged_for_review if audit else False,
    )
    result = run_lead_score(score_input)
    output = result.output

    score_row = LeadScore(
        lead_id=lead_id,
        based_on_audit_id=audit.id if audit else None,
        overall_score=output.overall_score,
        confidence=output.confidence,
        config_version=output.config_version,
        flagged_for_review=result.flagged_for_review,
        results_json=output.model_dump(mode="json"),
    )
    db.add(score_row)

    lead.score = output.overall_score

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead_id,
        action="scored",
        summary=f"Scored {output.overall_score}/100 (confidence: {output.confidence.value})",
    )

    db.commit()
    db.refresh(score_row)
    return _to_read(score_row)
