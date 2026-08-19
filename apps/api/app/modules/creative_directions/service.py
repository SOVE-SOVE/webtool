import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents import creative_director as creative_director_agent
from app.agents.creative_director import CreativeDirectorInput
from app.agents.website_audit import WebsiteAuditOutput
from app.core.settings import settings
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.creative_directions.schemas import (
    CreativeDirectionRead,
    CreativeDirectionUpdate,
    GenerateCreativeDirectionRequest,
)
from app.modules.leads.models import Lead
from app.modules.projects.models import Project
from app.modules.sales_audits.models import SalesAuditReport
from app.modules.website_audits.models import WebsiteAudit

_READ_OPTIONS = (
    joinedload(CreativeDirectionBrief.generated_by_user),
    joinedload(CreativeDirectionBrief.edited_by_user),
    joinedload(CreativeDirectionBrief.approved_by_user),
)


def _get_project_with_business(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID):
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Project.id == project_id)
        .options(joinedload(Project.client).joinedload(Client.business))
    )


def _latest_website_audit(db: Session, lead_id: uuid.UUID) -> WebsiteAudit | None:
    return db.scalar(
        select(WebsiteAudit).where(WebsiteAudit.lead_id == lead_id).order_by(WebsiteAudit.audited_at.desc())
    )


def _latest_sales_audit(db: Session, lead_id: uuid.UUID) -> SalesAuditReport | None:
    return db.scalar(
        select(SalesAuditReport)
        .where(SalesAuditReport.lead_id == lead_id)
        .order_by(SalesAuditReport.generated_at.desc())
    )


def _to_audit_output(audit: WebsiteAudit | None) -> WebsiteAuditOutput | None:
    if audit is None:
        return None
    return WebsiteAuditOutput(
        has_existing_site=audit.has_existing_site,
        mobile_friendly=audit.mobile_friendly,
        https=audit.https,
        load_time_ms=audit.load_time_ms,
        title=audit.title,
        meta_description=audit.meta_description,
        viewport_meta_present=audit.viewport_meta_present,
        audit_error=audit.audit_error,
    )


def _split(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _join(items: list[str]) -> str:
    return "\n".join(items)


def _build_sources_note(
    business: Business,
    lead: Lead | None,
    website_audit: WebsiteAudit | None,
    sales_audit: SalesAuditReport | None,
    request: GenerateCreativeDirectionRequest,
) -> str:
    parts = [f"Business record: {business.name} ({business.industry or 'industry unknown'})"]
    if website_audit is None:
        parts.append("Website audit: none available")
    elif not website_audit.has_existing_site:
        parts.append("Website audit: no existing site on record")
    elif website_audit.audit_error:
        parts.append(f"Website audit: could not be loaded ({website_audit.audit_error})")
    else:
        parts.append(f"Website audit: from {website_audit.audited_at.date().isoformat()}")

    if sales_audit is not None:
        parts.append(f"Prior sales audit: from {sales_audit.generated_at.date().isoformat()}")
    elif lead is not None:
        parts.append("Prior sales audit: none generated")
    else:
        parts.append("Prior sales audit: no linked lead on record")

    if request.target_audience:
        parts.append("Target audience: operator-supplied")
    else:
        parts.append("Target audience: not supplied — assumed")
    if request.business_goals:
        parts.append("Business goals: operator-supplied")
    else:
        parts.append("Business goals: not supplied — assumed")
    return "; ".join(parts)


def generate_creative_direction(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    project_id: uuid.UUID,
    request: GenerateCreativeDirectionRequest,
) -> CreativeDirectionRead | None:
    project = _get_project_with_business(db, workspace_id, project_id)
    if project is None:
        return None
    business = project.client.business

    lead = db.scalar(select(Lead).where(Lead.business_id == business.id))
    website_audit = _latest_website_audit(db, lead.id) if lead else None
    sales_audit = _latest_sales_audit(db, lead.id) if lead else None

    agent_input = CreativeDirectorInput(
        business_name=business.name,
        industry=business.industry,
        suburb=business.suburb,
        state=business.state,
        website_url=business.website_url,
        social_links=business.social_links,
        business_notes=business.notes,
        project_name=project.name,
        project_stage=project.stage.value,
        website_audit=_to_audit_output(website_audit),
        prior_research_summary=sales_audit.business_summary if sales_audit else None,
        prior_website_strengths=_split(sales_audit.website_strengths) if sales_audit else None,
        prior_top_problems=_split(sales_audit.top_problems) if sales_audit else None,
        prior_suggested_structure=_split(sales_audit.suggested_structure) if sales_audit else None,
        prior_suggested_offer=sales_audit.suggested_offer if sales_audit else None,
        target_audience=request.target_audience,
        business_goals=request.business_goals,
        additional_notes=request.additional_notes,
    )
    result = creative_director_agent.run(agent_input)
    output = result.output

    brief = CreativeDirectionBrief(
        project_id=project.id,
        status=CreativeDirectionStatus.DRAFT,
        target_audience=request.target_audience,
        business_goals=request.business_goals,
        facts=_join(output.facts),
        assumptions=_join(output.assumptions),
        creative_concept=output.creative_concept,
        visual_direction=output.visual_direction,
        brand_personality=_join(output.brand_personality),
        colour_direction=output.colour_direction,
        typography_direction=output.typography_direction,
        image_direction=output.image_direction,
        layout_direction=output.layout_direction,
        ux_direction=output.ux_direction,
        tone_of_voice=output.tone_of_voice,
        visual_hierarchy=output.visual_hierarchy,
        cta_strategy=output.cta_strategy,
        things_to_avoid=_join(output.things_to_avoid),
        references_inspiration=_join(output.references_inspiration),
        sources_note=_build_sources_note(business, lead, website_audit, sales_audit, request),
        flagged_for_review=result.flagged_for_review,
        review_notes=result.notes,
        model_used=settings.llm_model,
        prompt_version=creative_director_agent.PROMPT_VERSION,
        generated_by_user_id=actor_id,
    )
    db.add(brief)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="creative_direction_generated",
        summary=f"Generated creative direction for {project.name}",
    )

    db.commit()
    return get_creative_direction(db, workspace_id, brief.id)


def _base_query(workspace_id: uuid.UUID):
    return (
        select(CreativeDirectionBrief)
        .join(Project, CreativeDirectionBrief.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(*_READ_OPTIONS)
    )


def list_creative_directions(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> list[CreativeDirectionRead]:
    briefs = db.scalars(
        _base_query(workspace_id)
        .where(CreativeDirectionBrief.project_id == project_id)
        .order_by(CreativeDirectionBrief.generated_at.desc())
    )
    return [CreativeDirectionRead.from_model(b) for b in briefs]


def get_creative_direction(db: Session, workspace_id: uuid.UUID, brief_id: uuid.UUID) -> CreativeDirectionRead | None:
    brief = db.scalar(_base_query(workspace_id).where(CreativeDirectionBrief.id == brief_id))
    return CreativeDirectionRead.from_model(brief) if brief else None


def _get_brief_in_workspace(db: Session, workspace_id: uuid.UUID, brief_id: uuid.UUID) -> CreativeDirectionBrief | None:
    return db.scalar(
        select(CreativeDirectionBrief)
        .join(Project, CreativeDirectionBrief.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, CreativeDirectionBrief.id == brief_id)
        .options(*_READ_OPTIONS)
    )


_EDITABLE_LIST_FIELDS = {"facts", "assumptions", "brand_personality", "things_to_avoid", "references_inspiration"}


def update_creative_direction(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    brief_id: uuid.UUID,
    data: CreativeDirectionUpdate,
) -> CreativeDirectionRead | None:
    brief = _get_brief_in_workspace(db, workspace_id, brief_id)
    if brief is None:
        return None

    changed_fields = []
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        stored = _join(value) if field in _EDITABLE_LIST_FIELDS else value
        if getattr(brief, field) != stored:
            setattr(brief, field, stored)
            changed_fields.append(field)

    if changed_fields:
        brief.edited_by_user_id = actor_id
        brief.edited_at = datetime.now(timezone.utc)
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=brief.project_id,
            action="creative_direction_edited",
            summary=f"Edited creative direction: {', '.join(changed_fields)}",
        )
        db.commit()

    return get_creative_direction(db, workspace_id, brief_id)


def approve_creative_direction(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, brief_id: uuid.UUID
) -> CreativeDirectionRead | None:
    brief = _get_brief_in_workspace(db, workspace_id, brief_id)
    if brief is None:
        return None

    if brief.status != CreativeDirectionStatus.APPROVED:
        brief.status = CreativeDirectionStatus.APPROVED
        brief.approved_by_user_id = actor_id
        brief.approved_at = datetime.now(timezone.utc)
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=brief.project_id,
            action="creative_direction_approved",
            summary="Approved creative direction",
        )
        db.commit()

    return get_creative_direction(db, workspace_id, brief_id)
