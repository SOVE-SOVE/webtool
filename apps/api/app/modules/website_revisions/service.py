import copy
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from app.agents import website_revision
from app.agents.anti_slop import AntiSlopInput, AntiSlopOutput, AuthenticContent
from app.agents.anti_slop import PageInput as AntiSlopPageInput
from app.agents.anti_slop import SectionInput as AntiSlopSectionInput
from app.agents.anti_slop import run as run_anti_slop
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.creative_directions.models import CreativeDirectionBrief, CreativeDirectionStatus
from app.modules.projects.models import Project
from app.modules.website_revisions.models import RevisionKind, RevisionStatus, WebsiteRevision
from app.modules.website_revisions.schemas import DecisionRequest, RequestRevisionRequest, WebsiteRevisionRead
from app.modules.websites.models import Website

# Section types Section.tsx/packages/site-templates gives a spacing knob
# to today — see packages/site-templates/src/types.ts's SectionSpacing.
_SPACING_CAPABLE_TYPES = {"hero", "cta"}

# Deliberately broad — false positives just route feedback to the (safe,
# idempotent) deterministic spacing path instead of the LLM, which is
# the cheaper, more predictable outcome of a wrong guess either way.
_SPACING_KEYWORDS = re.compile(
    r"\b(spacing|padding|cramped|crowded|tighter|tight|dense|denser|breathing room|squeeze[d]?)\b",
    re.IGNORECASE,
)


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


def _get_website_in_workspace(db: Session, workspace_id: uuid.UUID, website_id: uuid.UUID) -> Website | None:
    return db.scalar(
        select(Website)
        .join(Project, Website.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Website.id == website_id)
    )


def _find_slot(config: dict | None, section_id: str) -> tuple[dict | None, str | None, str | None]:
    """(section dict, page slug or '__nav__'/'__footer__', human-readable location name)."""
    if not config:
        return None, None, None
    if config["navigation"]["id"] == section_id:
        return config["navigation"], "__nav__", "Navigation"
    if config["footer"]["id"] == section_id:
        return config["footer"], "__footer__", "Footer"
    for page in config.get("pages", []):
        for section in page["sections"]:
            if section["id"] == section_id:
                return section, page["slug"], page["name"]
    return None, None, None


def _replace_slot(config: dict, section_id: str, new_slot: dict) -> None:
    if config["navigation"]["id"] == section_id:
        config["navigation"] = new_slot
        return
    if config["footer"]["id"] == section_id:
        config["footer"] = new_slot
        return
    for page in config["pages"]:
        page["sections"] = [new_slot if s["id"] == section_id else s for s in page["sections"]]


def _apply_compact_spacing(config: dict, target_section_id: str | None) -> list[str]:
    """Sets spacing="compact" on every matching hero/cta section, or just
    `target_section_id` if given. Returns the human-readable location of
    every section actually changed (already-compact sections are left
    alone and not reported as changed)."""
    changed: list[str] = []

    def _maybe(section: dict, location: str) -> None:
        if section["type"] not in _SPACING_CAPABLE_TYPES:
            return
        if target_section_id is not None and section["id"] != target_section_id:
            return
        if section["config"].get("spacing") == "compact":
            return
        section["config"] = {**section["config"], "spacing": "compact"}
        changed.append(location)

    for page in config.get("pages", []):
        for section in page["sections"]:
            _maybe(section, f"{page['name']} ({section['type']})")
    return changed


def _resolve_creative_direction(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> CreativeDirectionBrief | None:
    base = (
        select(CreativeDirectionBrief)
        .join(Project, CreativeDirectionBrief.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, CreativeDirectionBrief.project_id == project_id)
    )
    approved = db.scalar(
        base.where(CreativeDirectionBrief.status == CreativeDirectionStatus.APPROVED).order_by(CreativeDirectionBrief.generated_at.desc())
    )
    return approved or db.scalar(base.order_by(CreativeDirectionBrief.generated_at.desc()))


def _business_name(db: Session, project_id: uuid.UUID) -> str:
    name = db.scalar(
        select(Business.name)
        .join(Client, Business.id == Client.business_id)
        .join(Project, Client.id == Project.client_id)
        .where(Project.id == project_id)
    )
    return name or ""


def _next_revision_number(db: Session, project_id: uuid.UUID) -> int:
    count = db.scalar(select(func.count()).select_from(WebsiteRevision).where(WebsiteRevision.project_id == project_id))
    return (count or 0) + 1


def _latest_website_id(db: Session, project_id: uuid.UUID) -> uuid.UUID | None:
    return db.scalar(select(Website.id).where(Website.project_id == project_id).order_by(Website.generated_at.desc()))


def request_revision(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, website_id: uuid.UUID, request: RequestRevisionRequest
) -> WebsiteRevisionRead | None:
    current = _get_website_in_workspace(db, workspace_id, website_id)
    if current is None:
        return None
    if not current.config:
        raise HTTPException(status_code=400, detail="This website version has no generated content to revise yet")

    slot, page_slug, page_name = (None, None, None)
    if request.section_id is not None:
        slot, page_slug, page_name = _find_slot(current.config, request.section_id)
        if slot is None:
            raise HTTPException(status_code=404, detail="Section not found on this website version")

    is_spacing = bool(_SPACING_KEYWORDS.search(request.requested_change))

    if not is_spacing and slot is None:
        raise HTTPException(
            status_code=400,
            detail="Specify which section this feedback applies to (section_id) — only a spacing-related "
            "request can be applied without one.",
        )
    if is_spacing and slot is not None and slot["type"] not in _SPACING_CAPABLE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"'{slot['type']}' sections don't have a spacing setting to tighten yet (only hero and cta do).",
        )

    new_config = copy.deepcopy(current.config)

    if is_spacing:
        kind = RevisionKind.SPACING
        section_type = slot["type"] if slot else None
        changed = _apply_compact_spacing(new_config, request.section_id)
        if changed:
            generated_change = f"Set compact mobile spacing on {len(changed)} section(s): {', '.join(changed)}."
        else:
            generated_change = (
                "No section on this site currently supports a spacing change (only hero/cta sections do), "
                "or spacing there was already compact — nothing changed."
            )
    else:
        assert slot is not None and page_slug is not None
        kind = RevisionKind.CONTENT
        section_type = slot["type"]
        creative_direction = _resolve_creative_direction(db, workspace_id, current.project_id)
        result = website_revision.run(
            website_revision.ReviseSectionInput(
                business_name=_business_name(db, current.project_id),
                section_type=slot["type"],
                current_config=slot["config"],
                requested_change=request.requested_change,
                tone_of_voice=creative_direction.tone_of_voice if creative_direction else None,
                cta_strategy=creative_direction.cta_strategy if creative_direction else None,
            )
        )
        revised_slot = {**slot, "config": result.output.config, "approved": False}
        _replace_slot(new_config, request.section_id, revised_slot)  # type: ignore[arg-type]
        generated_change = result.output.generated_change

    anti_slop = _recompute_anti_slop(new_config)
    new_website = Website(
        project_id=current.project_id,
        config=new_config,
        anti_slop_score=anti_slop.score,
        flagged_for_review=bool(new_config.get("missing_information")) or not anti_slop.passed,
        sources_note=current.sources_note,
        generated_by_user_id=actor_id,
    )
    db.add(new_website)
    db.flush()

    revision = WebsiteRevision(
        project_id=current.project_id,
        revision_number=_next_revision_number(db, current.project_id),
        kind=kind,
        status=RevisionStatus.PENDING,
        section_id=request.section_id,
        section_type=section_type,
        page_name=page_name,
        requested_change=request.requested_change,
        generated_change=generated_change,
        previous_website_id=current.id,
        resulting_website_id=new_website.id,
        created_by_user_id=actor_id,
    )
    db.add(revision)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=current.project_id,
        action="website_revision_requested",
        summary=f"Requested revision #{revision.revision_number}: {request.requested_change[:80]}",
    )
    db.commit()
    return get_revision(db, workspace_id, revision.id)


def approve_revision(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, revision_id: uuid.UUID, request: DecisionRequest
) -> WebsiteRevisionRead | None:
    revision = _get_revision_in_workspace(db, workspace_id, revision_id)
    if revision is None:
        return None
    if revision.status != RevisionStatus.PENDING:
        raise HTTPException(status_code=400, detail="This revision has already been decided.")

    revision.status = RevisionStatus.APPROVED
    revision.decided_by_user_id = actor_id
    revision.decided_at = datetime.now(timezone.utc)
    revision.decision_notes = request.notes

    if revision.section_id and revision.resulting_website_id:
        website = db.get(Website, revision.resulting_website_id)
        if website is not None and website.config:
            slot, _, _ = _find_slot(website.config, revision.section_id)
            if slot is not None and not slot.get("approved"):
                slot["approved"] = True
                flag_modified(website, "config")

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=revision.project_id,
        action="website_revision_approved",
        summary=f"Approved revision #{revision.revision_number}",
    )
    db.commit()
    return get_revision(db, workspace_id, revision.id)


def rollback_revision(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, revision_id: uuid.UUID, request: DecisionRequest
) -> WebsiteRevisionRead | None:
    """Restores the website content from immediately before `revision_id`
    — only ever the *most recent* revision for its project, so rolling
    back never silently discards a later, unrelated revision that was
    layered on top. See docs on RevisionKind.ROLLBACK."""
    revision = _get_revision_in_workspace(db, workspace_id, revision_id)
    if revision is None:
        return None
    if revision.status == RevisionStatus.REVERTED:
        raise HTTPException(status_code=400, detail="This revision has already been rolled back.")
    if revision.previous_website_id is None:
        raise HTTPException(status_code=400, detail="No prior version was recorded to roll back to.")

    latest_id = _latest_website_id(db, revision.project_id)
    if latest_id != revision.resulting_website_id:
        raise HTTPException(
            status_code=400,
            detail="Only the most recent revision can be rolled back — a newer revision already exists for this project.",
        )

    previous_website = db.get(Website, revision.previous_website_id)
    if previous_website is None or previous_website.config is None:
        raise HTTPException(status_code=400, detail="The prior version's content is no longer available.")

    restored_config = copy.deepcopy(previous_website.config)
    anti_slop = _recompute_anti_slop(restored_config)
    restored_website = Website(
        project_id=revision.project_id,
        config=restored_config,
        anti_slop_score=anti_slop.score,
        flagged_for_review=bool(restored_config.get("missing_information")) or not anti_slop.passed,
        sources_note=previous_website.sources_note,
        generated_by_user_id=actor_id,
    )
    db.add(restored_website)
    db.flush()

    now = datetime.now(timezone.utc)
    revision.status = RevisionStatus.REVERTED
    revision.decided_by_user_id = actor_id
    revision.decided_at = now
    revision.decision_notes = request.notes

    rollback_row = WebsiteRevision(
        project_id=revision.project_id,
        revision_number=_next_revision_number(db, revision.project_id),
        kind=RevisionKind.ROLLBACK,
        status=RevisionStatus.APPROVED,
        section_id=revision.section_id,
        section_type=revision.section_type,
        page_name=revision.page_name,
        requested_change=f"Roll back revision #{revision.revision_number}",
        generated_change=f"Restored the website content from immediately before revision #{revision.revision_number}.",
        previous_website_id=latest_id,
        resulting_website_id=restored_website.id,
        created_by_user_id=actor_id,
        decided_by_user_id=actor_id,
        decided_at=now,
    )
    db.add(rollback_row)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=revision.project_id,
        action="website_revision_rolled_back",
        summary=f"Rolled back revision #{revision.revision_number}",
    )
    db.commit()
    return get_revision(db, workspace_id, rollback_row.id)


def _base_query(workspace_id: uuid.UUID):
    return (
        select(WebsiteRevision)
        .join(Project, WebsiteRevision.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(joinedload(WebsiteRevision.created_by_user), joinedload(WebsiteRevision.decided_by_user))
    )


def _get_revision_in_workspace(db: Session, workspace_id: uuid.UUID, revision_id: uuid.UUID) -> WebsiteRevision | None:
    return db.scalar(_base_query(workspace_id).where(WebsiteRevision.id == revision_id))


def _to_read(r: WebsiteRevision) -> WebsiteRevisionRead:
    return WebsiteRevisionRead(
        id=r.id,
        project_id=r.project_id,
        revision_number=r.revision_number,
        kind=r.kind.value,
        status=r.status.value,
        section_id=r.section_id,
        section_type=r.section_type,
        page_name=r.page_name,
        requested_change=r.requested_change,
        generated_change=r.generated_change,
        previous_website_id=r.previous_website_id,
        resulting_website_id=r.resulting_website_id,
        created_by_user_id=r.created_by_user_id,
        created_by_user_name=r.created_by_user.name if r.created_by_user else None,
        created_at=r.created_at,
        decided_by_user_name=r.decided_by_user.name if r.decided_by_user else None,
        decided_at=r.decided_at,
        decision_notes=r.decision_notes,
    )


def get_revision(db: Session, workspace_id: uuid.UUID, revision_id: uuid.UUID) -> WebsiteRevisionRead | None:
    r = _get_revision_in_workspace(db, workspace_id, revision_id)
    return _to_read(r) if r is not None else None


def list_revisions(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> list[WebsiteRevisionRead]:
    revisions = db.scalars(
        _base_query(workspace_id).where(WebsiteRevision.project_id == project_id).order_by(WebsiteRevision.revision_number.desc())
    ).unique()
    return [_to_read(r) for r in revisions]


def list_revisions_for_website(db: Session, workspace_id: uuid.UUID, website_id: uuid.UUID) -> list[WebsiteRevisionRead] | None:
    website = _get_website_in_workspace(db, workspace_id, website_id)
    if website is None:
        return None
    return list_revisions(db, workspace_id, website.project_id)
