import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents import lead_score as lead_score_agent
from app.agents import sales_audit as sales_audit_agent
from app.agents import website_audit as website_audit_agent
from app.agents.lead_score import LeadScoreInput
from app.agents.sales_audit import SalesAuditInput
from app.agents.website_audit import WebsiteAuditInput
from app.core.settings import settings
from app.integrations import search as search_integration
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.leads.models import Lead
from app.modules.sales_audits.models import SalesAuditReport
from app.modules.sales_audits.schemas import SalesAuditRead
from app.modules.website_audits import service as website_audits_service


def _get_lead_with_business(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
    return db.scalar(
        select(Lead)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Lead.id == lead_id)
        .options(joinedload(Lead.business))
    )


def _search_query_for(business: Business) -> str:
    parts = [business.name, business.suburb, business.state]
    return " ".join(p for p in parts if p)


def _build_sources_note(
    business: Business,
    website_audit_output,
    search_query: str,
    search_results,
    lead_score: int | None,
    lead_score_reasons: list[str] | None = None,
) -> str:
    parts = []
    if not business.website_url:
        parts.append("Website: none on record")
    elif website_audit_output.audit_error:
        parts.append(f"Website: {business.website_url} (could not be loaded: {website_audit_output.audit_error})")
    else:
        parts.append(f"Website: {business.website_url} (fetched live, mobile viewport)")

    if not settings.brave_search_api_key:
        parts.append("Public search: not configured")
    elif search_results is None:
        parts.append(f"Public search: {search_query!r} attempted, unavailable")
    elif not search_results:
        parts.append(f"Public search: {search_query!r} returned no results")
    else:
        parts.append(f"Public search: {search_query!r} via Brave Search, {len(search_results)} result(s) reviewed")

    if lead_score is None:
        parts.append("Lead score: not scored")
    elif lead_score_reasons:
        parts.append(f"Lead score: {lead_score} ({', '.join(lead_score_reasons)})")
    else:
        parts.append(f"Lead score: {lead_score}")
    return "; ".join(parts)


def generate_sales_audit(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, lead_id: uuid.UUID
) -> SalesAuditRead | None:
    lead = _get_lead_with_business(db, workspace_id, lead_id)
    if lead is None:
        return None
    business = lead.business

    audit_result = website_audit_agent.run(WebsiteAuditInput(website_url=business.website_url))
    website_audit_row = website_audits_service.create_from_agent_output(db, lead.id, audit_result.output)

    score_result = lead_score_agent.run(LeadScoreInput(website_audit=audit_result.output))
    lead.score = score_result.output.score
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="lead_score_computed",
        summary=f"Lead score computed: {score_result.output.score}/100 ({'; '.join(score_result.output.reasons)})",
    )

    search_query = _search_query_for(business)
    search_results = search_integration.search_business(search_query)

    report_result = sales_audit_agent.run(
        SalesAuditInput(
            business_name=business.name,
            industry=business.industry,
            suburb=business.suburb,
            state=business.state,
            website_url=business.website_url,
            social_links=business.social_links,
            business_notes=business.notes,
            lead_status=lead.status.value,
            lead_priority=lead.priority.value,
            lead_score=lead.score,
            lead_source=lead.source,
            lead_notes=lead.notes,
            website_audit=audit_result.output,
            search_query=search_query,
            search_results=search_results,
        )
    )
    output = report_result.output

    # Either agent flagging is enough to flag the report — a broken/
    # unreachable site makes the score itself unreliable even when the
    # LLM found enough elsewhere (search results) not to flag on its own.
    flagged_for_review = report_result.flagged_for_review or score_result.flagged_for_review
    review_notes = "; ".join(n for n in (report_result.notes, score_result.notes) if n) or None

    report = SalesAuditReport(
        lead_id=lead.id,
        website_audit_id=website_audit_row.id,
        business_summary=output.business_summary,
        website_strengths="\n".join(output.website_strengths),
        top_problems="\n".join(output.top_problems),
        why_problems_matter="\n".join(output.why_problems_matter),
        recommended_improvements="\n".join(output.recommended_improvements),
        suggested_structure="\n".join(output.suggested_structure),
        talking_points="\n".join(output.talking_points),
        potential_objections="\n".join(output.potential_objections),
        suggested_offer=output.suggested_offer,
        sources_note=_build_sources_note(
            business, audit_result.output, search_query, search_results, lead.score, score_result.output.reasons
        ),
        flagged_for_review=flagged_for_review,
        review_notes=review_notes,
        model_used=settings.llm_model,
        prompt_version=sales_audit_agent.PROMPT_VERSION,
        generated_by_user_id=actor_id,
    )
    db.add(report)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="lead",
        entity_id=lead.id,
        action="sales_audit_generated",
        summary=f"Generated sales audit for {business.name}",
    )

    db.commit()
    db.refresh(report)
    return SalesAuditRead.from_model(report)


def list_sales_audits(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> list[SalesAuditRead]:
    query = (
        select(SalesAuditReport)
        .join(Lead, SalesAuditReport.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, SalesAuditReport.lead_id == lead_id)
        .options(joinedload(SalesAuditReport.website_audit), joinedload(SalesAuditReport.generated_by_user))
        .order_by(SalesAuditReport.generated_at.desc())
    )
    reports = db.scalars(query)
    return [SalesAuditRead.from_model(r) for r in reports]


def get_sales_audit(db: Session, workspace_id: uuid.UUID, audit_id: uuid.UUID) -> SalesAuditRead | None:
    report = db.scalar(
        select(SalesAuditReport)
        .join(Lead, SalesAuditReport.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, SalesAuditReport.id == audit_id)
        .options(joinedload(SalesAuditReport.website_audit), joinedload(SalesAuditReport.generated_by_user))
    )
    return SalesAuditRead.from_model(report) if report else None
