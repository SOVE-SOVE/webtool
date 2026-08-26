import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents import sitemap as sitemap_agent
from app.agents.sitemap import SitemapInput
from app.core.settings import settings
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.design_briefs.models import DesignBrief
from app.modules.projects import service as projects_service
from app.modules.projects.models import Project, ProjectStage
from app.modules.sitemaps.models import NavPlacement, PageType, Sitemap, SitemapPage, SitemapStatus
from app.modules.sitemaps.schemas import (
    GenerateSitemapRequest,
    ReorderSitemapPagesRequest,
    SitemapPageCreate,
    SitemapPageUpdate,
    SitemapRead,
)

_READ_OPTIONS = (
    joinedload(Sitemap.generated_by_user),
    joinedload(Sitemap.approved_by_user),
    joinedload(Sitemap.pages),
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


_BRIEF_CONTEXT_FIELDS = [
    ("business_description", "Business description"),
    ("services_products", "Services/products"),
    ("target_customers", "Target customers"),
    ("business_goals", "Business goals"),
    ("required_pages", "Pages the client wants"),
    ("required_functionality", "Functionality the client wants"),
    ("testimonials", "Testimonials on file"),
    ("faqs", "FAQs on file"),
    ("calls_to_action", "Calls to action the client wants"),
    ("existing_website_url", "Existing website"),
]


def _build_brief_notes(brief: DesignBrief | None) -> str | None:
    if brief is None:
        return None
    lines = []
    for field, label in _BRIEF_CONTEXT_FIELDS:
        value = getattr(brief, field)
        if value:
            lines.append(f"{label}: {value}")
    return "\n".join(lines) if lines else None


def _build_creative_direction_notes(cd: CreativeDirectionBrief | None) -> str | None:
    if cd is None:
        return None
    return "\n".join(
        [
            f"Creative concept: {cd.creative_concept}",
            f"UX direction: {cd.ux_direction}",
            f"CTA strategy: {cd.cta_strategy}",
            f"Conversion goal: {cd.conversion_goal or 'not set'}",
            f"Visual hierarchy: {cd.visual_hierarchy}",
            f"Tone of voice: {cd.tone_of_voice}",
            f"Brand personality: {cd.brand_personality}",
            f"Things to avoid: {cd.things_to_avoid}",
        ]
    )


def _build_sources_note(brief: DesignBrief | None, creative_direction: CreativeDirectionBrief | None) -> str:
    parts = []
    parts.append(f"Client brief: {brief.status.value}" if brief is not None else "Client brief: not started")
    parts.append(
        f"Creative direction: {creative_direction.status.value} (generated {creative_direction.generated_at.date().isoformat()})"
        if creative_direction is not None
        else "Creative direction: none generated"
    )
    return "; ".join(parts)


def _join(items: list[str]) -> str:
    return "\n".join(items)


def generate_sitemap(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    project_id: uuid.UUID,
    request: GenerateSitemapRequest,
) -> SitemapRead | None:
    project = _get_project_with_business(db, workspace_id, project_id)
    if project is None:
        return None
    business = project.client.business

    brief = _get_design_brief(db, project.id)
    creative_direction = _resolve_creative_direction(db, workspace_id, project.id, request.creative_direction_id)

    target_audience = (creative_direction.target_audience if creative_direction else None) or (
        brief.target_customers if brief else None
    )
    business_goals = (creative_direction.business_goals if creative_direction else None) or (
        brief.business_goals if brief else None
    )
    conversion_goal = (creative_direction.conversion_goal if creative_direction else None) or (
        brief.calls_to_action if brief else None
    )

    agent_input = SitemapInput(
        business_name=business.name,
        industry=business.industry,
        project_name=project.name,
        target_audience=target_audience,
        business_goals=business_goals,
        conversion_goal=conversion_goal,
        brief_notes=_build_brief_notes(brief),
        creative_direction_notes=_build_creative_direction_notes(creative_direction),
        additional_notes=request.additional_notes,
    )
    result = sitemap_agent.run(agent_input)
    output = result.output

    # Column defaults (default=uuid.uuid4) only apply at flush time, but
    # the pages below need sitemap.id / each other's ids up front to
    # resolve parent_slug references before the first flush.
    sitemap = Sitemap(
        id=uuid.uuid4(),
        project_id=project.id,
        overview=output.overview,
        creative_direction_id=creative_direction.id if creative_direction else None,
        sources_note=_build_sources_note(brief, creative_direction),
        flagged_for_review=result.flagged_for_review,
        review_notes=result.notes,
        model_used=settings.llm_model,
        prompt_version=sitemap_agent.PROMPT_VERSION,
        generated_by_user_id=actor_id,
    )
    db.add(sitemap)

    order_counter: dict[str | None, int] = defaultdict(int)
    seen_slugs: set[str] = set()
    orig_slug_to_row: dict[str, SitemapPage] = {}

    for page in output.pages:
        slug = page.slug
        n = 2
        while slug in seen_slugs:
            slug = f"{page.slug}-{n}"
            n += 1
        seen_slugs.add(slug)

        row = SitemapPage(
            id=uuid.uuid4(),
            sitemap_id=sitemap.id,
            title=page.title,
            slug=slug,
            page_type=PageType(page.page_type),
            nav_placement=NavPlacement(page.nav_placement),
            order_index=order_counter[page.parent_slug],
            purpose=page.purpose,
            target_audience=page.target_audience or None,
            primary_cta=page.primary_cta or None,
            secondary_cta=page.secondary_cta or None,
            conversion_goal=page.conversion_goal or None,
            seo_intent=page.seo_intent or None,
            key_sections=_join(page.key_sections),
            required_content=_join(page.required_content),
            required_assets=_join(page.required_assets),
            required_functionality=_join(page.required_functionality),
        )
        order_counter[page.parent_slug] += 1
        db.add(row)
        orig_slug_to_row[page.slug] = row

    for page in output.pages:
        if page.parent_slug is None:
            continue
        parent_row = orig_slug_to_row.get(page.parent_slug)
        row = orig_slug_to_row[page.slug]
        if parent_row is not None and parent_row is not row:
            row.parent_page_id = parent_row.id

    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="sitemap_generated",
        summary=f"Generated sitemap for {project.name} ({len(output.pages)} pages)",
    )

    db.commit()
    return get_sitemap(db, workspace_id, sitemap.id)


def _base_query(workspace_id: uuid.UUID):
    return (
        select(Sitemap)
        .join(Project, Sitemap.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(*_READ_OPTIONS)
    )


def list_sitemaps(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> list[SitemapRead]:
    sitemaps = db.scalars(
        _base_query(workspace_id).where(Sitemap.project_id == project_id).order_by(Sitemap.generated_at.desc())
    ).unique()
    return [SitemapRead.from_model(s) for s in sitemaps]


def get_sitemap(db: Session, workspace_id: uuid.UUID, sitemap_id: uuid.UUID) -> SitemapRead | None:
    sitemap = db.scalar(_base_query(workspace_id).where(Sitemap.id == sitemap_id))
    return SitemapRead.from_model(sitemap) if sitemap else None


def _get_sitemap_in_workspace(db: Session, workspace_id: uuid.UUID, sitemap_id: uuid.UUID) -> Sitemap | None:
    return db.scalar(
        select(Sitemap)
        .join(Project, Sitemap.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Sitemap.id == sitemap_id)
        .options(*_READ_OPTIONS)
    )


def _get_page(sitemap: Sitemap, page_id: uuid.UUID) -> SitemapPage | None:
    for page in sitemap.pages:
        if page.id == page_id:
            return page
    return None


def _next_order_index(sitemap: Sitemap, parent_page_id: uuid.UUID | None) -> int:
    siblings = [p for p in sitemap.pages if p.parent_page_id == parent_page_id]
    return max((p.order_index for p in siblings), default=-1) + 1


def _revert_approval(sitemap: Sitemap) -> bool:
    """Structural edits to an approved sitemap invalidate that sign-off
    — same "edit reverts approval" contract as DesignBrief.status and
    CreativeDirectionBrief.status (see docs/05_DECISIONS.md). Returns
    whether it actually reverted anything, for the activity-log summary."""
    if sitemap.status != SitemapStatus.APPROVED:
        return False
    sitemap.status = SitemapStatus.DRAFT
    sitemap.approved_by_user_id = None
    sitemap.approved_at = None
    return True


def add_page(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, sitemap_id: uuid.UUID, data: SitemapPageCreate
) -> SitemapRead | None:
    sitemap = _get_sitemap_in_workspace(db, workspace_id, sitemap_id)
    if sitemap is None:
        return None

    if any(p.slug == data.slug for p in sitemap.pages):
        raise HTTPException(status_code=400, detail=f"A page with slug '{data.slug}' already exists in this sitemap")

    parent_page_id = data.parent_page_id
    if parent_page_id is not None and _get_page(sitemap, parent_page_id) is None:
        raise HTTPException(status_code=400, detail="parent_page_id does not belong to this sitemap")

    order_index = data.order_index if data.order_index is not None else _next_order_index(sitemap, parent_page_id)

    page = SitemapPage(
        sitemap_id=sitemap.id,
        parent_page_id=parent_page_id,
        title=data.title,
        slug=data.slug,
        page_type=data.page_type,
        nav_placement=data.nav_placement,
        order_index=order_index,
        purpose=data.purpose,
        target_audience=data.target_audience,
        primary_cta=data.primary_cta,
        secondary_cta=data.secondary_cta,
        conversion_goal=data.conversion_goal,
        seo_intent=data.seo_intent,
        key_sections=_join(data.key_sections),
        required_content=_join(data.required_content),
        required_assets=_join(data.required_assets),
        required_functionality=_join(data.required_functionality),
    )
    db.add(page)
    reverted = _revert_approval(sitemap)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=sitemap.project_id,
        action="sitemap_page_added",
        summary=f"Added page '{data.title}' to sitemap" + (" — reverted to draft, needs re-approval" if reverted else ""),
    )
    db.commit()
    return get_sitemap(db, workspace_id, sitemap_id)


_LIST_FIELDS = {"key_sections", "required_content", "required_assets", "required_functionality"}


def update_page(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    sitemap_id: uuid.UUID,
    page_id: uuid.UUID,
    data: SitemapPageUpdate,
) -> SitemapRead | None:
    sitemap = _get_sitemap_in_workspace(db, workspace_id, sitemap_id)
    if sitemap is None:
        return None
    page = _get_page(sitemap, page_id)
    if page is None:
        return None

    provided = data.model_dump(exclude_unset=True)

    if "slug" in provided and provided["slug"] != page.slug:
        if any(p.id != page.id and p.slug == provided["slug"] for p in sitemap.pages):
            raise HTTPException(
                status_code=400, detail=f"A page with slug '{provided['slug']}' already exists in this sitemap"
            )

    if "parent_page_id" in provided:
        new_parent_id = provided["parent_page_id"]
        if new_parent_id is not None:
            if new_parent_id == page.id:
                raise HTTPException(status_code=400, detail="A page cannot be its own parent")
            parent = _get_page(sitemap, new_parent_id)
            if parent is None:
                raise HTTPException(status_code=400, detail="parent_page_id does not belong to this sitemap")
            # Cycle check: walk parent's ancestor chain looking for `page`.
            ancestor = parent
            while ancestor is not None:
                if ancestor.id == page.id:
                    raise HTTPException(status_code=400, detail="That would create a circular parent relationship")
                ancestor = _get_page(sitemap, ancestor.parent_page_id) if ancestor.parent_page_id else None

    changed = False
    for field, value in provided.items():
        stored = _join(value) if field in _LIST_FIELDS else value
        if stored != getattr(page, field):
            setattr(page, field, stored)
            changed = True

    if changed:
        reverted = _revert_approval(sitemap)
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=sitemap.project_id,
            action="sitemap_page_edited",
            summary=f"Edited sitemap page '{page.title}'" + (" — reverted to draft, needs re-approval" if reverted else ""),
        )
        db.commit()

    return get_sitemap(db, workspace_id, sitemap_id)


def delete_page(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, sitemap_id: uuid.UUID, page_id: uuid.UUID
) -> SitemapRead | None:
    sitemap = _get_sitemap_in_workspace(db, workspace_id, sitemap_id)
    if sitemap is None:
        return None
    page = _get_page(sitemap, page_id)
    if page is None:
        return None

    # Promote any children to top-level rather than cascading the delete,
    # so removing e.g. "Services" doesn't silently blow away service
    # detail pages the operator may still want.
    for child in sitemap.pages:
        if child.parent_page_id == page.id:
            child.parent_page_id = None

    title = page.title
    db.delete(page)
    reverted = _revert_approval(sitemap)

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=sitemap.project_id,
        action="sitemap_page_removed",
        summary=f"Removed page '{title}' from sitemap" + (" — reverted to draft, needs re-approval" if reverted else ""),
    )
    db.commit()
    return get_sitemap(db, workspace_id, sitemap_id)


def reorder_pages(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    sitemap_id: uuid.UUID,
    request: ReorderSitemapPagesRequest,
) -> SitemapRead | None:
    sitemap = _get_sitemap_in_workspace(db, workspace_id, sitemap_id)
    if sitemap is None:
        return None

    by_id = {p.id: p for p in sitemap.pages}
    for item in request.items:
        if item.id not in by_id:
            raise HTTPException(status_code=400, detail=f"Page {item.id} does not belong to this sitemap")

    for item in request.items:
        page = by_id[item.id]
        provided = item.model_fields_set
        if "parent_page_id" in provided:
            new_parent_id = item.parent_page_id
            if new_parent_id is not None:
                if new_parent_id == page.id:
                    raise HTTPException(status_code=400, detail="A page cannot be its own parent")
                if new_parent_id not in by_id:
                    raise HTTPException(status_code=400, detail="parent_page_id does not belong to this sitemap")
                ancestor = by_id[new_parent_id]
                while ancestor is not None:
                    if ancestor.id == page.id:
                        raise HTTPException(
                            status_code=400, detail="That would create a circular parent relationship"
                        )
                    ancestor = by_id.get(ancestor.parent_page_id) if ancestor.parent_page_id else None
            page.parent_page_id = new_parent_id
        page.order_index = item.order_index

    reverted = _revert_approval(sitemap)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=sitemap.project_id,
        action="sitemap_pages_reordered",
        summary="Reordered sitemap pages" + (" — reverted to draft, needs re-approval" if reverted else ""),
    )
    db.commit()
    return get_sitemap(db, workspace_id, sitemap_id)


def approve_sitemap(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, sitemap_id: uuid.UUID) -> SitemapRead | None:
    sitemap = _get_sitemap_in_workspace(db, workspace_id, sitemap_id)
    if sitemap is None:
        return None

    if sitemap.status != SitemapStatus.APPROVED:
        sitemap.status = SitemapStatus.APPROVED
        sitemap.approved_by_user_id = actor_id
        sitemap.approved_at = datetime.now(timezone.utc)
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=sitemap.project_id,
            action="sitemap_approved",
            summary="Approved sitemap",
        )
        project = db.get(Project, sitemap.project_id)
        if project is not None:
            projects_service.advance_stage(
                db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.DESIGN
            )
        db.commit()

    return get_sitemap(db, workspace_id, sitemap_id)
