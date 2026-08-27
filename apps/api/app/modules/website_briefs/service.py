import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents import website_brief as website_brief_agent
from app.agents.website_brief import WebsiteBriefInput
from app.core.settings import settings
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.design_briefs.models import DesignBrief
from app.modules.projects import service as projects_service
from app.modules.projects.models import Project, ProjectStage
from app.modules.sitemaps.models import Sitemap, SitemapStatus
from app.modules.website_briefs.models import WebsiteBrief, WebsiteBriefStatus
from app.modules.website_briefs.schemas import GenerateWebsiteBriefRequest, WebsiteBriefRead, WebsiteBriefUpdate

_READ_OPTIONS = (
    joinedload(WebsiteBrief.generated_by_user),
    joinedload(WebsiteBrief.edited_by_user),
    joinedload(WebsiteBrief.approved_by_user),
)


def _get_project_with_business(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Project.id == project_id)
        .options(joinedload(Project.client).joinedload(Client.business))
    )


def _get_design_brief(db: Session, project_id: uuid.UUID) -> DesignBrief | None:
    return db.scalar(select(DesignBrief).where(DesignBrief.project_id == project_id))


def _resolve_creative_direction(
    db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID, creative_direction_id: uuid.UUID | None
) -> CreativeDirectionBrief | None:
    base = (
        select(CreativeDirectionBrief)
        .join(Project, CreativeDirectionBrief.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, CreativeDirectionBrief.project_id == project_id)
    )
    if creative_direction_id is not None:
        return db.scalar(base.where(CreativeDirectionBrief.id == creative_direction_id))
    approved = db.scalar(
        base.where(CreativeDirectionBrief.status == CreativeDirectionStatus.APPROVED).order_by(
            CreativeDirectionBrief.generated_at.desc()
        )
    )
    if approved is not None:
        return approved
    return db.scalar(base.order_by(CreativeDirectionBrief.generated_at.desc()))


def _resolve_sitemap(
    db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID, sitemap_id: uuid.UUID | None
) -> Sitemap | None:
    base = (
        select(Sitemap)
        .join(Project, Sitemap.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Sitemap.project_id == project_id)
        .options(joinedload(Sitemap.pages))
    )
    if sitemap_id is not None:
        return db.scalar(base.where(Sitemap.id == sitemap_id))
    approved = db.scalar(
        base.where(Sitemap.status == SitemapStatus.APPROVED).order_by(Sitemap.generated_at.desc())
    )
    if approved is not None:
        return approved
    return db.scalar(base.order_by(Sitemap.generated_at.desc()))


def _split(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _join(items: list[str]) -> str:
    return "\n".join(items)


def _resolve(operator_value: str | None, other_value: str | None) -> tuple[str | None, str]:
    """Operator-supplied value at generation time wins over an upstream
    source; the source wins over nothing. Same convention as
    creative_directions/service.py's _resolve."""
    if operator_value:
        return operator_value, "operator-supplied"
    if other_value:
        return other_value, "from an existing source"
    return None, "not supplied — assumed"


# (intake field, human label) — the broad set relevant to a client-facing
# brief (strategy + content + technical), unlike Creative Director's
# narrower visual-focused subset.
_INTAKE_CONTEXT_FIELDS = [
    ("business_description", "Business description"),
    ("services_products", "Services/products"),
    ("target_customers", "Target customers"),
    ("business_goals", "Business goals"),
    ("about_content", "About/business content on file"),
    ("services_content", "Services content on file"),
    ("products_content", "Products content on file"),
    ("testimonials", "Testimonials on file"),
    ("faqs", "FAQs on file"),
    ("calls_to_action", "Calls to action the client wants"),
    ("required_pages", "Pages the client wants"),
    ("required_functionality", "Functionality the client wants"),
    ("existing_website_url", "Existing website"),
    ("domain", "Domain"),
    ("hosting", "Hosting"),
    ("integrations", "Integrations"),
]


def _build_brief_notes(brief: DesignBrief | None) -> str | None:
    if brief is None:
        return None
    lines = []
    for field, label in _INTAKE_CONTEXT_FIELDS:
        value = getattr(brief, field)
        if value:
            lines.append(f"{label}: {value}")
    return "\n".join(lines) if lines else None


def _build_confirmed_requirements(brief: DesignBrief | None) -> list[str]:
    """Verbatim client-supplied facts — the "confirmed client requirements"
    half of the feature's required AI-vs-confirmed split. Only what the
    client actually answered during intake; nothing inferred."""
    if brief is None:
        return []
    return [f"{label}: {getattr(brief, field)}" for field, label in _INTAKE_CONTEXT_FIELDS if getattr(brief, field)]


def _build_creative_direction_notes(cd: CreativeDirectionBrief | None) -> str | None:
    if cd is None:
        return None
    return "\n".join(
        [
            f"Creative concept: {cd.creative_concept}",
            f"Visual direction: {cd.visual_direction}",
            f"Tone of voice: {cd.tone_of_voice}",
            f"CTA strategy: {cd.cta_strategy}",
            f"Things to avoid: {cd.things_to_avoid}",
        ]
    )


def _build_sitemap_notes(sitemap: Sitemap | None) -> str | None:
    if sitemap is None:
        return None
    lines = [f"Overview: {sitemap.overview}"] if sitemap.overview else []
    for page in sitemap.pages:
        lines.append(
            f"- {page.title} ({page.page_type.value}): {page.purpose}"
            f" | primary CTA: {page.primary_cta or 'none'}"
            f" | required content: {page.required_content or 'none'}"
            f" | required functionality: {page.required_functionality or 'none'}"
        )
    return "\n".join(lines) if lines else None


def _sitemap_page_summary(sitemap: Sitemap) -> tuple[list[str], list[str], list[str], list[str]]:
    """Deterministically assembled sitemap_summary/page_purposes/
    content_requirements/functionality from a real, reviewed Sitemap —
    real structure the operator already approved (or is reviewing) beats
    a fresh LLM guess, same "don't re-invent what already exists"
    reasoning as website_generator.py composing only real sitemap fields."""
    sitemap_summary = [f"{page.title} — {page.purpose}" for page in sitemap.pages]
    page_purposes = [f"{page.title}: {page.purpose}" for page in sitemap.pages]
    content_requirements: list[str] = []
    functionality: list[str] = []
    for page in sitemap.pages:
        for item in _split(page.required_content or ""):
            line = f"{page.title}: {item}"
            if line not in content_requirements:
                content_requirements.append(line)
        for item in _split(page.required_functionality or ""):
            if item not in functionality:
                functionality.append(item)
    return sitemap_summary, page_purposes, content_requirements, functionality


def _build_sources_note(
    design_brief: DesignBrief | None,
    creative_direction: CreativeDirectionBrief | None,
    sitemap: Sitemap | None,
    target_audience_source: str,
) -> str:
    parts = [
        f"Client intake brief: {design_brief.status.value}" if design_brief is not None else "Client intake brief: not started",
        (
            f"Creative direction: {creative_direction.status.value} (generated {creative_direction.generated_at.date().isoformat()})"
            if creative_direction is not None
            else "Creative direction: none generated"
        ),
        (
            f"Sitemap: {sitemap.status.value} (generated {sitemap.generated_at.date().isoformat()}, {len(sitemap.pages)} pages)"
            if sitemap is not None
            else "Sitemap: none generated"
        ),
        f"Target audience: {target_audience_source}",
    ]
    return "; ".join(parts)


def _build_ai_suggestions(
    *,
    has_business_goals: bool,
    used_real_target_audience: bool,
    used_real_creative_direction: bool,
    used_real_sitemap: bool,
) -> list[str]:
    """Explicit, per-section callouts of what this generation itself is
    suggesting (as opposed to carrying through an already-confirmed fact
    or an already-reviewed upstream decision) — the "clearly distinguish
    AI suggestions from confirmed client requirements" half of the
    feature's required split."""
    suggestions = [
        "Project summary — AI-synthesized narrative, not supplied by the client.",
        "Goals — AI-synthesized list"
        + (", grounded in the client's stated business goals." if has_business_goals else "; no business goals were supplied, so this is inferred from industry/context."),
        "Positioning — AI-suggested strategic recommendation; no client source confirms positioning.",
        "SEO considerations — AI-suggested best practice for this business; not requested by the client.",
        "Technical requirements — AI-suggested based on the described functionality; confirm against actual hosting/domain plans.",
    ]
    if not used_real_target_audience:
        suggestions.append("Target audience — AI-inferred; not confirmed by the client or an existing creative direction.")
    if not used_real_creative_direction:
        suggestions.append("CTA strategy and visual direction — AI-suggested first drafts; no creative direction has been generated/approved for this project yet.")
    if not used_real_sitemap:
        suggestions.append("Sitemap, page purposes, content requirements, and functionality — AI-proposed; no sitemap has been generated/approved for this project yet.")
    return suggestions


def generate_website_brief(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    project_id: uuid.UUID,
    request: GenerateWebsiteBriefRequest,
) -> WebsiteBriefRead | None:
    project = _get_project_with_business(db, workspace_id, project_id)
    if project is None:
        return None
    business = project.client.business

    design_brief = _get_design_brief(db, project.id)
    creative_direction = _resolve_creative_direction(db, workspace_id, project.id, request.creative_direction_id)
    sitemap = _resolve_sitemap(db, workspace_id, project.id, request.sitemap_id)

    real_target_audience = (creative_direction.target_audience if creative_direction else None) or (
        design_brief.target_customers if design_brief else None
    )
    target_audience, target_audience_source = _resolve(request.target_audience, real_target_audience)
    business_goals, _ = _resolve(
        request.business_goals,
        (creative_direction.business_goals if creative_direction else None) or (design_brief.business_goals if design_brief else None),
    )

    agent_input = WebsiteBriefInput(
        business_name=business.name,
        industry=business.industry,
        project_name=project.name,
        target_audience=target_audience,
        business_goals=business_goals,
        brief_notes=_build_brief_notes(design_brief),
        creative_direction_notes=_build_creative_direction_notes(creative_direction),
        sitemap_notes=_build_sitemap_notes(sitemap),
        additional_notes=request.additional_notes,
    )
    result = website_brief_agent.run(agent_input)
    output = result.output

    # Prefer real, already-decided content over a fresh guess wherever a
    # reviewed upstream artifact exists — never let this generation
    # silently re-invent a decision that's already been made. See
    # docs/05_DECISIONS.md.
    used_real_target_audience = bool(real_target_audience) or bool(request.target_audience)
    resolved_target_audience = target_audience if used_real_target_audience else output.target_audience

    used_real_creative_direction = creative_direction is not None
    cta_strategy = creative_direction.cta_strategy if used_real_creative_direction else output.cta_strategy
    visual_direction = creative_direction.visual_direction if used_real_creative_direction else output.visual_direction

    used_real_sitemap = sitemap is not None and len(sitemap.pages) > 0
    if used_real_sitemap:
        sitemap_summary, page_purposes, content_requirements, functionality = _sitemap_page_summary(sitemap)
    else:
        sitemap_summary, page_purposes = output.sitemap_summary, output.page_purposes
        content_requirements, functionality = output.content_requirements, output.functionality

    brief = WebsiteBrief(
        project_id=project.id,
        status=WebsiteBriefStatus.DRAFT,
        creative_direction_id=creative_direction.id if creative_direction else None,
        sitemap_id=sitemap.id if sitemap else None,
        project_summary=output.project_summary,
        goals=_join(output.goals),
        target_audience=resolved_target_audience,
        positioning=output.positioning,
        sitemap_summary=_join(sitemap_summary),
        page_purposes=_join(page_purposes),
        content_requirements=_join(content_requirements),
        cta_strategy=cta_strategy,
        visual_direction=visual_direction,
        functionality=_join(functionality),
        seo_considerations=_join(output.seo_considerations),
        technical_requirements=_join(output.technical_requirements),
        confirmed_requirements=_join(_build_confirmed_requirements(design_brief)),
        ai_suggestions=_join(
            _build_ai_suggestions(
                has_business_goals=bool(business_goals),
                used_real_target_audience=used_real_target_audience,
                used_real_creative_direction=used_real_creative_direction,
                used_real_sitemap=used_real_sitemap,
            )
        ),
        sources_note=_build_sources_note(design_brief, creative_direction, sitemap, target_audience_source),
        flagged_for_review=result.flagged_for_review,
        review_notes=result.notes,
        model_used=settings.llm_model,
        prompt_version=website_brief_agent.PROMPT_VERSION,
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
        action="website_brief_generated",
        summary=f"Generated website brief for {project.name}",
    )

    db.commit()
    return get_website_brief(db, workspace_id, brief.id)


def _base_query(workspace_id: uuid.UUID):
    return (
        select(WebsiteBrief)
        .join(Project, WebsiteBrief.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(*_READ_OPTIONS)
    )


def list_website_briefs(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> list[WebsiteBriefRead]:
    briefs = db.scalars(
        _base_query(workspace_id).where(WebsiteBrief.project_id == project_id).order_by(WebsiteBrief.generated_at.desc())
    )
    return [WebsiteBriefRead.from_model(b) for b in briefs]


def get_website_brief(db: Session, workspace_id: uuid.UUID, brief_id: uuid.UUID) -> WebsiteBriefRead | None:
    brief = db.scalar(_base_query(workspace_id).where(WebsiteBrief.id == brief_id))
    return WebsiteBriefRead.from_model(brief) if brief else None


def _get_brief_in_workspace(db: Session, workspace_id: uuid.UUID, brief_id: uuid.UUID) -> WebsiteBrief | None:
    return db.scalar(
        select(WebsiteBrief)
        .join(Project, WebsiteBrief.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, WebsiteBrief.id == brief_id)
        .options(*_READ_OPTIONS)
    )


_EDITABLE_LIST_FIELDS = {
    "goals",
    "sitemap_summary",
    "page_purposes",
    "content_requirements",
    "functionality",
    "seo_considerations",
    "technical_requirements",
    "confirmed_requirements",
    "ai_suggestions",
}


def update_website_brief(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    brief_id: uuid.UUID,
    data: WebsiteBriefUpdate,
) -> WebsiteBriefRead | None:
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

        reverted_approval = False
        if brief.status == WebsiteBriefStatus.APPROVED:
            # Same "edit invalidates sign-off" contract as DesignBrief/
            # CreativeDirectionBrief/Sitemap — see docs/05_DECISIONS.md.
            brief.status = WebsiteBriefStatus.DRAFT
            brief.approved_by_user_id = None
            brief.approved_at = None
            reverted_approval = True

        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=brief.project_id,
            action="website_brief_edited",
            summary=f"Edited website brief: {', '.join(changed_fields)}"
            + (" — reverted to draft, needs re-approval" if reverted_approval else ""),
        )
        db.commit()

    return get_website_brief(db, workspace_id, brief_id)


def approve_website_brief(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, brief_id: uuid.UUID
) -> WebsiteBriefRead | None:
    brief = _get_brief_in_workspace(db, workspace_id, brief_id)
    if brief is None:
        return None

    if brief.status != WebsiteBriefStatus.APPROVED:
        brief.status = WebsiteBriefStatus.APPROVED
        brief.approved_by_user_id = actor_id
        brief.approved_at = datetime.now(timezone.utc)
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=brief.project_id,
            action="website_brief_approved",
            summary="Approved website brief",
        )
        project = db.get(Project, brief.project_id)
        if project is not None:
            projects_service.advance_stage(
                db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.DESIGN
            )
        db.commit()

    return get_website_brief(db, workspace_id, brief_id)
