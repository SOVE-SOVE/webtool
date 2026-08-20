import copy
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from app.agents import website_generator
from app.agents.anti_slop import AntiSlopInput, AntiSlopOutput, AuthenticContent
from app.agents.anti_slop import PageInput as AntiSlopPageInput
from app.agents.anti_slop import SectionInput as AntiSlopSectionInput
from app.agents.anti_slop import run as run_anti_slop
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.design_briefs.models import BriefStatus, DesignBrief
from app.modules.projects import service as projects_service
from app.modules.projects.models import Project, ProjectStage
from app.modules.qa_reports.models import QaReport
from app.modules.sitemaps.models import Sitemap, SitemapStatus
from app.modules.websites.models import Website
from app.modules.websites.schemas import (
    ApproveWebsiteRequest,
    GenerateWebsiteRequest,
    SectionUpdate,
    WebsiteRead,
    WebsiteSummary,
)

_READ_OPTIONS = (
    joinedload(Website.generated_by_user),
    joinedload(Website.approved_by_user),
    joinedload(Website.client_approved_by_user),
)


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
    approved = db.scalar(
        base.where(Sitemap.status == SitemapStatus.APPROVED).order_by(Sitemap.generated_at.desc())
    )
    return approved or db.scalar(base.order_by(Sitemap.generated_at.desc()))


def _brief_content(brief: DesignBrief | None) -> website_generator.BriefContent:
    if brief is None:
        return website_generator.BriefContent()
    return website_generator.BriefContent(
        business_description=brief.business_description,
        services_products=brief.services_products,
        services_content=brief.services_content,
        products_content=brief.products_content,
        about_content=brief.about_content,
        contact_email=brief.contact_email,
        contact_phone=brief.contact_phone,
        location=brief.location,
        testimonials=_split(brief.testimonials),
        faqs=_split(brief.faqs),
        calls_to_action=_split(brief.calls_to_action),
    )


def _creative_direction_content(cd: CreativeDirectionBrief | None) -> website_generator.CreativeDirectionContent:
    if cd is None:
        return website_generator.CreativeDirectionContent()
    return website_generator.CreativeDirectionContent(cta_strategy=cd.cta_strategy, tone_of_voice=cd.tone_of_voice)


def _sitemap_page_contents(sitemap: Sitemap | None) -> list[website_generator.SitemapPageContent]:
    if sitemap is None:
        return []
    pages = sorted(sitemap.pages, key=lambda p: p.order_index)
    return [
        website_generator.SitemapPageContent(
            id=str(page.id),
            title=page.title,
            slug=page.slug,
            page_type=page.page_type.value,
            nav_placement=page.nav_placement.value,
            primary_cta=page.primary_cta,
            secondary_cta=page.secondary_cta,
            key_sections=_split(page.key_sections),
        )
        for page in pages
    ]


def _section_to_dict(section: website_generator.GeneratedSection) -> dict:
    return {"id": section.id, "type": section.type, "config": section.config, "approved": section.approved}


def _output_to_config(output: website_generator.WebsiteGeneratorOutput, authentic_testimonials: list[str]) -> dict:
    return {
        "navigation": _section_to_dict(output.navigation),
        "footer": _section_to_dict(output.footer),
        "pages": [
            {
                "sitemap_page_id": page.sitemap_page_id,
                "name": page.name,
                "slug": page.slug,
                "page_type": page.page_type,
                "seo": page.seo.model_dump(),
                "sections": [_section_to_dict(s) for s in page.sections],
            }
            for page in output.pages
        ],
        # Content the generator had no honest source for, so it built
        # the section without it (or skipped the section entirely) —
        # not recoverable by re-inspecting the config afterward, so it's
        # captured here at generation time. See get_website(), which
        # adds the (config-inspectable) Anti-Slop missing_information on
        # top of this at read time.
        "missing_information": output.missing_information,
        # The brief's testimonials at generation time — recompute needs
        # this to tell a legitimately-sourced testimonial apart from a
        # fabricated one (see _recompute_anti_slop). Kept alongside the
        # generation rather than re-fetched from the (possibly since-
        # edited) brief, since it reflects what was actually used.
        "authentic_testimonials": authentic_testimonials,
    }


def _index_approved(config: dict | None) -> dict[tuple[str, str], dict]:
    """Maps (page_slug_or_'__nav__'/'__footer__', section_type) -> the
    approved section dict at that slot, for carrying approved content
    forward across a regeneration. Keyed by slot+type, not id, since a
    fresh generation always mints new ids."""
    index: dict[tuple[str, str], dict] = {}
    if not config:
        return index
    for key, slot in (("__nav__", config.get("navigation")), ("__footer__", config.get("footer"))):
        if slot and slot.get("approved"):
            index[(key, slot["type"])] = slot
    for page in config.get("pages", []):
        for section in page.get("sections", []):
            if section.get("approved"):
                index[(page["slug"], section["type"])] = section
    return index


def _apply_preserved_approvals(fresh_config: dict, previous_config: dict | None) -> dict:
    approved_index = _index_approved(previous_config)
    if not approved_index:
        return fresh_config

    nav_key = ("__nav__", fresh_config["navigation"]["type"])
    if nav_key in approved_index:
        fresh_config["navigation"] = approved_index[nav_key]
    footer_key = ("__footer__", fresh_config["footer"]["type"])
    if footer_key in approved_index:
        fresh_config["footer"] = approved_index[footer_key]

    for page in fresh_config["pages"]:
        page["sections"] = [
            approved_index.get((page["slug"], section["type"]), section) for section in page["sections"]
        ]
    return fresh_config


def _recompute_anti_slop(config: dict) -> AntiSlopOutput:
    pages = [
        AntiSlopPageInput(
            name=page["name"],
            sections=[AntiSlopSectionInput(type=s["type"], config=s["config"]) for s in page["sections"]],
        )
        for page in config.get("pages", [])
    ]
    authentic_content = AuthenticContent(known_testimonial_quotes=config.get("authentic_testimonials", []))
    return run_anti_slop(AntiSlopInput(pages=pages, authentic_content=authentic_content)).output


def _sources_note(brief: DesignBrief | None, cd: CreativeDirectionBrief | None, sitemap: Sitemap | None) -> str:
    parts = [
        f"Client brief: {brief.status.value}" if brief else "Client brief: not started",
        f"Creative direction: {cd.status.value}" if cd else "Creative direction: none generated",
        f"Sitemap: {sitemap.status.value} ({len(sitemap.pages)} pages)" if sitemap else "Sitemap: none generated",
    ]
    return "; ".join(parts)


def generate_website(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID, request: GenerateWebsiteRequest
) -> WebsiteRead | None:
    project = _get_project_with_business(db, workspace_id, project_id)
    if project is None:
        return None
    business = project.client.business

    sitemap = _resolve_sitemap(db, workspace_id, project.id, request.sitemap_id)
    if sitemap is None or not sitemap.pages:
        raise HTTPException(status_code=400, detail="Project has no sitemap with pages to generate a website from yet")

    brief = _get_design_brief(db, project.id)
    creative_direction = _resolve_creative_direction(db, workspace_id, project.id, request.creative_direction_id)

    result = website_generator.run(
        website_generator.WebsiteGeneratorInput(
            business_name=business.name,
            brief=_brief_content(brief),
            creative_direction=_creative_direction_content(creative_direction),
            pages=_sitemap_page_contents(sitemap),
        )
    )
    fresh_config = _output_to_config(result.output, _brief_content(brief).testimonials)

    previous = db.scalar(
        select(Website).where(Website.project_id == project.id).order_by(Website.generated_at.desc())
    )
    config = fresh_config if request.force_regenerate_all else _apply_preserved_approvals(fresh_config, previous.config if previous else None)
    anti_slop = _recompute_anti_slop(config)

    website = Website(
        project_id=project.id,
        config=config,
        anti_slop_score=anti_slop.score,
        flagged_for_review=result.flagged_for_review or not anti_slop.passed,
        sources_note=_sources_note(brief, creative_direction, sitemap),
        generated_by_user_id=actor_id,
    )
    db.add(website)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="website_generated",
        summary=f"Generated website for {project.name} ({len(config['pages'])} pages, quality score {anti_slop.score})",
    )
    projects_service.advance_stage(
        db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.DEVELOPMENT
    )
    db.commit()
    return get_website(db, workspace_id, website.id)


def regenerate_section(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, website_id: uuid.UUID, section_id: str
) -> WebsiteRead | None:
    current = _get_website_in_workspace(db, workspace_id, website_id)
    if current is None:
        return None

    slot, page_slug = _find_slot(current.config, section_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="Section not found on this website version")

    project = _get_project_with_business(db, workspace_id, current.project_id)
    sitemap = _resolve_sitemap(db, workspace_id, current.project_id, None)
    brief = _get_design_brief(db, current.project_id)
    creative_direction = _resolve_creative_direction(db, workspace_id, current.project_id, None)
    if sitemap is None or not sitemap.pages:
        raise HTTPException(status_code=400, detail="No sitemap available to regenerate from")

    brief_content = _brief_content(brief)
    result = website_generator.run(
        website_generator.WebsiteGeneratorInput(
            business_name=project.client.business.name if project else "",
            brief=brief_content,
            creative_direction=_creative_direction_content(creative_direction),
            pages=_sitemap_page_contents(sitemap),
        )
    )
    fresh_config = _output_to_config(result.output, brief_content.testimonials)
    fresh_index = _index_by_slot(fresh_config)
    replacement = fresh_index.get((page_slug, slot["type"]))
    if replacement is None:
        raise HTTPException(
            status_code=400,
            detail="This section's content is no longer available to regenerate — its source data may have changed.",
        )

    new_config = copy.deepcopy(current.config)
    new_config["authentic_testimonials"] = brief_content.testimonials
    if page_slug == "__nav__":
        new_config["navigation"] = replacement
    elif page_slug == "__footer__":
        new_config["footer"] = replacement
    else:
        for page in new_config["pages"]:
            if page["slug"] == page_slug:
                page["sections"] = [
                    replacement if s["id"] == section_id else s for s in page["sections"]
                ]

    anti_slop = _recompute_anti_slop(new_config)
    new_website = Website(
        project_id=current.project_id,
        config=new_config,
        anti_slop_score=anti_slop.score,
        flagged_for_review=not anti_slop.passed,
        sources_note=current.sources_note,
        generated_by_user_id=actor_id,
    )
    db.add(new_website)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=current.project_id,
        action="website_section_regenerated",
        summary=f"Regenerated a {slot['type']} section",
    )
    db.commit()
    return get_website(db, workspace_id, new_website.id)


def _index_by_slot(config: dict) -> dict[tuple[str, str], dict]:
    index: dict[tuple[str, str], dict] = {
        ("__nav__", config["navigation"]["type"]): config["navigation"],
        ("__footer__", config["footer"]["type"]): config["footer"],
    }
    for page in config["pages"]:
        for section in page["sections"]:
            index[(page["slug"], section["type"])] = section
    return index


def _find_slot(config: dict | None, section_id: str) -> tuple[dict | None, str | None]:
    if not config:
        return None, None
    if config["navigation"]["id"] == section_id:
        return config["navigation"], "__nav__"
    if config["footer"]["id"] == section_id:
        return config["footer"], "__footer__"
    for page in config.get("pages", []):
        for section in page["sections"]:
            if section["id"] == section_id:
                return section, page["slug"]
    return None, None


def update_section(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, website_id: uuid.UUID, section_id: str, data: SectionUpdate
) -> WebsiteRead | None:
    website = _get_website_in_workspace(db, workspace_id, website_id)
    if website is None:
        return None

    slot, _ = _find_slot(website.config, section_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="Section not found on this website version")

    changed = False
    content_changed = False
    if data.config is not None:
        slot["config"] = {**slot["config"], **data.config}
        changed = True
        content_changed = True
    if data.approved is not None and data.approved != slot["approved"]:
        slot["approved"] = data.approved
        changed = True

    if changed:
        # `slot` is a reference nested inside website.config, so it was
        # already mutated above — a plain reassignment here would give
        # SQLAlchemy's dirty-check an "old" value that's already equal
        # (by content) to the "new" one, since they're the same mutated
        # object graph, and the column would silently not be persisted.
        # flag_modified forces the UPDATE regardless of that equality
        # check — the standard fix for in-place JSON column mutation.
        flag_modified(website, "config")
        anti_slop = _recompute_anti_slop(website.config)
        website.anti_slop_score = anti_slop.score
        website.flagged_for_review = not anti_slop.passed

        reverted = []
        if content_changed:
            # A section's own `approved` flag toggling alone isn't a
            # content change — only actually editing what a section
            # says invalidates the whole-version sign-offs, same "edit
            # reverts approval" contract as every other approval
            # checkpoint (docs/05_DECISIONS.md).
            if website.approved:
                website.approved = False
                website.approved_by_user_id = None
                website.approved_at = None
                reverted.append("website")
            if website.client_approved:
                website.client_approved = False
                website.client_approved_by_user_id = None
                website.client_approved_at = None
                reverted.append("client review")

        summary = f"Updated a {slot['type']} section" + (" and approved it" if data.approved else "")
        if reverted:
            summary += f" — reverted {' and '.join(reverted)} approval, needs re-approval"
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=website.project_id,
            action="website_section_updated",
            summary=summary,
        )
        db.commit()

    return get_website(db, workspace_id, website_id)


def approve_website(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, website_id: uuid.UUID, request: ApproveWebsiteRequest
) -> WebsiteRead | None:
    """Approval checkpoint 4 ("Generated website"). Requires the brief,
    the latest creative direction, and the latest sitemap to currently
    be approved — the same prerequisite chain website generation itself
    resolves against, made an explicit gate here per "do not bypass the
    approval system for convenience"."""
    website = _get_website_in_workspace(db, workspace_id, website_id)
    if website is None:
        return None

    brief = _get_design_brief(db, website.project_id)
    creative_direction = _resolve_creative_direction(db, workspace_id, website.project_id, None)
    sitemap = _resolve_sitemap(db, workspace_id, website.project_id, None)

    missing = []
    if brief is None or brief.status != BriefStatus.APPROVED:
        missing.append("client brief")
    if creative_direction is None or creative_direction.status != CreativeDirectionStatus.APPROVED:
        missing.append("creative direction")
    if sitemap is None or sitemap.status != SitemapStatus.APPROVED:
        missing.append("sitemap")
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve this website until the following are approved first: {', '.join(missing)}.",
        )

    website.approved = True
    website.approved_by_user_id = actor_id
    website.approved_at = datetime.now(timezone.utc)
    website.approval_notes = request.notes

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=website.project_id,
        action="website_approved",
        summary="Approved generated website",
    )
    project = db.get(Project, website.project_id)
    if project is not None:
        projects_service.advance_stage(
            db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.QA
        )
    db.commit()
    return get_website(db, workspace_id, website_id)


def client_approve_website(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, website_id: uuid.UUID, request: ApproveWebsiteRequest
) -> WebsiteRead | None:
    """Approval checkpoint 6 ("Client review") — recorded by an
    operator on the client's behalf (see Website.client_approved_by_user_id's
    docstring). Requires this version to already be operator-approved
    (checkpoint 4) and its latest QA report to be human-approved
    (checkpoint 5)."""
    website = _get_website_in_workspace(db, workspace_id, website_id)
    if website is None:
        return None

    if not website.approved:
        raise HTTPException(status_code=400, detail="Cannot record client approval until the generated website itself is approved.")

    latest_qa = db.scalar(
        select(QaReport).where(QaReport.website_id == website.id).order_by(QaReport.created_at.desc())
    )
    if latest_qa is None or not latest_qa.human_approved:
        raise HTTPException(status_code=400, detail="Cannot record client approval until QA has been approved for this version.")

    website.client_approved = True
    website.client_approved_by_user_id = actor_id
    website.client_approved_at = datetime.now(timezone.utc)
    website.client_approval_notes = request.notes

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=website.project_id,
        action="website_client_approved",
        summary="Recorded client approval",
    )
    project = db.get(Project, website.project_id)
    if project is not None:
        projects_service.advance_stage(
            db, workspace_id=workspace_id, actor_id=actor_id, project=project, new_stage=ProjectStage.READY_TO_DEPLOY
        )
    db.commit()
    return get_website(db, workspace_id, website_id)


def _base_query(workspace_id: uuid.UUID):
    return (
        select(Website)
        .join(Project, Website.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(*_READ_OPTIONS)
    )


def _get_website_in_workspace(db: Session, workspace_id: uuid.UUID, website_id: uuid.UUID) -> Website | None:
    return db.scalar(_base_query(workspace_id).where(Website.id == website_id))


def list_websites(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> list[WebsiteSummary]:
    websites = db.scalars(
        _base_query(workspace_id).where(Website.project_id == project_id).order_by(Website.generated_at.desc())
    ).unique()
    return [
        WebsiteSummary(
            id=w.id,
            status=w.status,
            anti_slop_score=w.anti_slop_score,
            flagged_for_review=w.flagged_for_review,
            generated_by_user_name=w.generated_by_user.name if w.generated_by_user else None,
            generated_at=w.generated_at,
            approved=w.approved,
            client_approved=w.client_approved,
        )
        for w in websites
    ]


def get_website(db: Session, workspace_id: uuid.UUID, website_id: uuid.UUID) -> WebsiteRead | None:
    website = _get_website_in_workspace(db, workspace_id, website_id)
    if website is None or website.config is None:
        return None
    anti_slop = _recompute_anti_slop(website.config)
    config = website.config
    return WebsiteRead(
        id=website.id,
        project_id=website.project_id,
        status=website.status,
        navigation=config["navigation"],
        footer=config["footer"],
        pages=config["pages"],
        missing_information=[*config.get("missing_information", []), *anti_slop.missing_information],
        anti_slop_score=anti_slop.score,
        anti_slop_passed=anti_slop.passed,
        anti_slop_issues=[i.model_dump() for i in anti_slop.issues],
        flagged_for_review=website.flagged_for_review,
        sources_note=website.sources_note,
        generated_by_user_id=website.generated_by_user_id,
        generated_by_user_name=website.generated_by_user.name if website.generated_by_user else None,
        generated_at=website.generated_at,
        updated_at=website.updated_at,
        approved=website.approved,
        approved_by_user_name=website.approved_by_user.name if website.approved_by_user else None,
        approved_at=website.approved_at,
        approval_notes=website.approval_notes,
        client_approved=website.client_approved,
        client_approved_by_user_name=website.client_approved_by_user.name if website.client_approved_by_user else None,
        client_approved_at=website.client_approved_at,
        client_approval_notes=website.client_approval_notes,
    )
