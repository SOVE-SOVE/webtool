import copy
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from app.agents import content_generator as content_generator_agent
from app.agents.content_generator import ContentGeneratorInput
from app.core.settings import settings
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.content_drafts.models import ContentDraft, ContentDraftStatus
from app.modules.content_drafts.schemas import (
    ApproveContentDraftRequest,
    ContentDraftRead,
    ContentDraftSummary,
    ContentPageUpdate,
    GenerateContentDraftRequest,
    PageContentDraft,
)
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.design_briefs.models import DesignBrief
from app.modules.projects.models import Project
from app.modules.sitemaps.models import Sitemap, SitemapStatus

_READ_OPTIONS = (joinedload(ContentDraft.generated_by_user), joinedload(ContentDraft.approved_by_user))


def _split(text: str | None) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()] if text else []


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
    return approved or db.scalar(base.order_by(CreativeDirectionBrief.generated_at.desc()))


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
    approved = db.scalar(base.where(Sitemap.status == SitemapStatus.APPROVED).order_by(Sitemap.generated_at.desc()))
    return approved or db.scalar(base.order_by(Sitemap.generated_at.desc()))


def _page_to_dict(page: PageContentDraft) -> dict:
    return page.model_dump()


def _output_to_config(output, sitemap: Sitemap) -> dict:
    pages_by_id = {str(p.id): p for p in sitemap.pages}
    pages = []
    for drafted in output.pages:
        page = pages_by_id.get(drafted.page_id)
        pages.append(
            PageContentDraft(
                page_id=drafted.page_id,
                page_title=page.title if page else drafted.page_id,
                seo_title=drafted.seo_title,
                meta_description=drafted.meta_description,
                hero_heading=drafted.hero_heading,
                hero_subheading=drafted.hero_subheading,
                body=drafted.body,
                services=[s.model_dump() for s in drafted.services],
                faqs=[f.model_dump() for f in drafted.faqs],
                cta_heading=drafted.cta_heading,
                cta_body=drafted.cta_body,
            )
        )
    return {"pages": [_page_to_dict(p) for p in pages]}


def _sources_note(brief: DesignBrief | None, cd: CreativeDirectionBrief | None, sitemap: Sitemap, tone: str) -> str:
    parts = [
        f"Client brief: {brief.status.value}" if brief else "Client brief: not started",
        f"Creative direction: {cd.status.value}" if cd else "Creative direction: none generated",
        f"Sitemap: {sitemap.status.value} ({len(sitemap.pages)} pages)",
        f"Tone: {tone}",
    ]
    return "; ".join(parts)


def generate_content_draft(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID, request: GenerateContentDraftRequest
) -> ContentDraftRead | None:
    project = _get_project_with_business(db, workspace_id, project_id)
    if project is None:
        return None
    business = project.client.business

    sitemap = _resolve_sitemap(db, workspace_id, project.id, request.sitemap_id)
    if sitemap is None or not sitemap.pages:
        raise HTTPException(status_code=400, detail="Project has no sitemap with pages to draft content from yet")

    brief = _get_design_brief(db, project.id)
    creative_direction = _resolve_creative_direction(db, workspace_id, project.id, request.creative_direction_id)

    agent_input = ContentGeneratorInput(
        business_name=business.name,
        industry=business.industry,
        location=", ".join(filter(None, [business.suburb, business.state])) or None,
        tone=request.tone,
        brief=content_generator_agent.ContentBriefContent(
            business_description=brief.business_description if brief else None,
            services_products=brief.services_products if brief else None,
            services_content=brief.services_content if brief else None,
            products_content=brief.products_content if brief else None,
            about_content=brief.about_content if brief else None,
            faqs=_split(brief.faqs) if brief else [],
            calls_to_action=_split(brief.calls_to_action) if brief else [],
            target_customers=brief.target_customers if brief else None,
            business_goals=brief.business_goals if brief else None,
        ),
        creative_direction=content_generator_agent.ContentCreativeDirectionContent(
            creative_concept=creative_direction.creative_concept if creative_direction else None,
            tone_of_voice=creative_direction.tone_of_voice if creative_direction else None,
            brand_personality=_split(creative_direction.brand_personality) if creative_direction else [],
            cta_strategy=creative_direction.cta_strategy if creative_direction else None,
        ),
        pages=[
            content_generator_agent.ContentSitemapPage(
                id=str(p.id),
                title=p.title,
                slug=p.slug,
                page_type=p.page_type.value,
                purpose=p.purpose,
                primary_cta=p.primary_cta,
                secondary_cta=p.secondary_cta,
                key_sections=_split(p.key_sections),
                required_content=_split(p.required_content),
            )
            for p in sorted(sitemap.pages, key=lambda p: p.order_index)
        ],
        additional_notes=request.additional_notes,
    )
    result = content_generator_agent.run(agent_input)
    config = _output_to_config(result.output, sitemap)

    draft = ContentDraft(
        project_id=project.id,
        status=ContentDraftStatus.DRAFT,
        tone=request.tone,
        sitemap_id=sitemap.id,
        creative_direction_id=creative_direction.id if creative_direction else None,
        config=config,
        missing_information="\n".join(result.output.missing_information) or None,
        sources_note=_sources_note(brief, creative_direction, sitemap, request.tone),
        flagged_for_review=result.flagged_for_review,
        review_notes=result.notes,
        model_used=settings.llm_model,
        prompt_version=content_generator_agent.PROMPT_VERSION,
        generated_by_user_id=actor_id,
    )
    db.add(draft)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="content_draft_generated",
        summary=f"Generated website content draft for {project.name} ({len(config['pages'])} pages, {request.tone} tone)",
    )
    db.commit()
    return get_content_draft(db, workspace_id, draft.id)


def _base_query(workspace_id: uuid.UUID):
    return (
        select(ContentDraft)
        .join(Project, ContentDraft.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(*_READ_OPTIONS)
    )


def _get_draft_in_workspace(db: Session, workspace_id: uuid.UUID, draft_id: uuid.UUID) -> ContentDraft | None:
    return db.scalar(_base_query(workspace_id).where(ContentDraft.id == draft_id))


def _to_read(draft: ContentDraft) -> ContentDraftRead:
    config = draft.config or {"pages": []}
    return ContentDraftRead(
        id=draft.id,
        project_id=draft.project_id,
        status=draft.status,
        tone=draft.tone,
        sitemap_id=draft.sitemap_id,
        creative_direction_id=draft.creative_direction_id,
        pages=[PageContentDraft.model_validate(p) for p in config.get("pages", [])],
        missing_information=_split(draft.missing_information),
        rolled_back_from_id=draft.rolled_back_from_id,
        sources_note=draft.sources_note,
        flagged_for_review=draft.flagged_for_review,
        review_notes=draft.review_notes,
        model_used=draft.model_used,
        generated_by_user_id=draft.generated_by_user_id,
        generated_by_user_name=draft.generated_by_user.name if draft.generated_by_user else None,
        generated_at=draft.generated_at,
        updated_at=draft.updated_at,
        approved_by_user_name=draft.approved_by_user.name if draft.approved_by_user else None,
        approved_at=draft.approved_at,
    )


def list_content_drafts(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> list[ContentDraftSummary]:
    drafts = db.scalars(
        _base_query(workspace_id).where(ContentDraft.project_id == project_id).order_by(ContentDraft.generated_at.desc())
    ).unique()
    return [
        ContentDraftSummary(
            id=d.id,
            status=d.status,
            tone=d.tone,
            flagged_for_review=d.flagged_for_review,
            generated_by_user_name=d.generated_by_user.name if d.generated_by_user else None,
            generated_at=d.generated_at,
            approved=d.status == ContentDraftStatus.APPROVED,
        )
        for d in drafts
    ]


def get_content_draft(db: Session, workspace_id: uuid.UUID, draft_id: uuid.UUID) -> ContentDraftRead | None:
    draft = _get_draft_in_workspace(db, workspace_id, draft_id)
    return _to_read(draft) if draft else None


def _find_page(config: dict | None, page_id: str) -> dict | None:
    if not config:
        return None
    return next((p for p in config.get("pages", []) if p["page_id"] == page_id), None)


def update_page(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, draft_id: uuid.UUID, page_id: str, data: ContentPageUpdate
) -> ContentDraftRead | None:
    draft = _get_draft_in_workspace(db, workspace_id, draft_id)
    if draft is None:
        return None

    page = _find_page(draft.config, page_id)
    if page is None:
        raise HTTPException(status_code=404, detail="Page not found on this content draft version")

    changes = data.model_dump(exclude_unset=True)
    if not changes:
        return _to_read(draft)

    for field, value in changes.items():
        if field in ("services", "faqs") and value is not None:
            page[field] = [item if isinstance(item, dict) else item.model_dump() for item in value]
        else:
            page[field] = value

    # `page` is a dict nested inside draft.config, already mutated above —
    # flag_modified forces SQLAlchemy to persist the in-place JSON change,
    # same reasoning as modules/websites/service.py's update_section.
    flag_modified(draft, "config")

    reverted = False
    if draft.status == ContentDraftStatus.APPROVED:
        draft.status = ContentDraftStatus.DRAFT
        draft.approved_by_user_id = None
        draft.approved_at = None
        reverted = True

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=draft.project_id,
        action="content_draft_page_updated",
        summary=f"Edited drafted content for '{page.get('page_title', page_id)}'"
        + (" — reverted to draft, needs re-approval" if reverted else ""),
    )
    db.commit()
    return get_content_draft(db, workspace_id, draft_id)


def approve_content_draft(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, draft_id: uuid.UUID, request: ApproveContentDraftRequest
) -> ContentDraftRead | None:
    draft = _get_draft_in_workspace(db, workspace_id, draft_id)
    if draft is None:
        return None

    if draft.status != ContentDraftStatus.APPROVED:
        draft.status = ContentDraftStatus.APPROVED
        draft.approved_by_user_id = actor_id
        draft.approved_at = datetime.now(timezone.utc)
        draft.review_notes = request.notes or draft.review_notes
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=draft.project_id,
            action="content_draft_approved",
            summary="Approved website content draft",
        )
        db.commit()

    return get_content_draft(db, workspace_id, draft_id)


def rollback_content_draft(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, draft_id: uuid.UUID
) -> ContentDraftRead | None:
    """Creates a brand-new latest version whose content is a copy of an
    older version's — the same "nothing is ever deleted, newest wins"
    convention every other version-tracked entity here uses, made
    explicit as an action per roadmap Task 3's "allow rollback to
    previous versions". The restored version starts back in DRAFT, since
    it needs its own re-approval rather than inheriting the one that
    belonged to whatever content most recently replaced it."""
    target = _get_draft_in_workspace(db, workspace_id, draft_id)
    if target is None:
        return None

    restored = ContentDraft(
        project_id=target.project_id,
        status=ContentDraftStatus.DRAFT,
        tone=target.tone,
        sitemap_id=target.sitemap_id,
        creative_direction_id=target.creative_direction_id,
        config=copy.deepcopy(target.config),
        missing_information=target.missing_information,
        rolled_back_from_id=target.id,
        sources_note=target.sources_note,
        flagged_for_review=target.flagged_for_review,
        review_notes=f"Rolled back to the version generated at {target.generated_at.isoformat()}.",
        model_used=target.model_used,
        prompt_version=target.prompt_version,
        generated_by_user_id=actor_id,
    )
    db.add(restored)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=target.project_id,
        action="content_draft_rolled_back",
        summary=f"Rolled back website content to the version generated at {target.generated_at.isoformat()}",
    )
    db.commit()
    return get_content_draft(db, workspace_id, restored.id)
