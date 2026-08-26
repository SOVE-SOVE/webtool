import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.settings import settings
from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.previews.models import PreviewAudience, PreviewLink
from app.modules.previews.schemas import (
    PreviewLinkCreate,
    PreviewLinkRead,
    PreviewVersionSummary,
    PublicPreviewPage,
    PublicPreviewRead,
    PublicPreviewSection,
)
from app.modules.projects.models import Project
from app.modules.websites.models import Website

_READ_OPTIONS = (joinedload(PreviewLink.created_by_user), joinedload(PreviewLink.revoked_by_user))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Project.id == project_id)
    )


def _to_read(link: PreviewLink, *, url: str | None = None) -> PreviewLinkRead:
    now = datetime.now(timezone.utc)
    expired = link.expires_at is not None and link.expires_at <= now
    revoked = link.revoked_at is not None
    return PreviewLinkRead(
        id=link.id,
        project_id=link.project_id,
        audience=link.audience,
        label=link.label,
        url=url,
        token_suffix=link.token_suffix,
        active=not revoked and not expired,
        revoked=revoked,
        expired=expired,
        expires_at=link.expires_at,
        last_accessed_at=link.last_accessed_at,
        access_count=link.access_count,
        created_by_user_name=link.created_by_user.name if link.created_by_user else None,
        created_at=link.created_at,
    )


def create_preview_link(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID, request: PreviewLinkCreate
) -> PreviewLinkRead | None:
    project = _project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None

    token = secrets.token_urlsafe(32)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(days=request.expires_in_days)
        if request.expires_in_days is not None
        else None
    )
    link = PreviewLink(
        project_id=project_id,
        token_hash=_hash_token(token),
        token_suffix=token[-6:],
        audience=request.audience,
        label=request.label,
        created_by_user_id=actor_id,
        expires_at=expires_at,
    )
    db.add(link)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project_id,
        action="preview_link_created",
        summary=f"Created a {request.audience.value} preview link" + (f" ({request.label})" if request.label else ""),
    )
    db.commit()
    db.refresh(link)
    return _to_read(link, url=f"{settings.app_base_url}/preview/{token}")


def list_preview_links(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> list[PreviewLinkRead] | None:
    project = _project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None
    links = db.scalars(
        select(PreviewLink)
        .where(PreviewLink.project_id == project_id)
        .order_by(PreviewLink.created_at.desc())
        .options(*_READ_OPTIONS)
    )
    return [_to_read(link) for link in links]


def _get_link_in_workspace(db: Session, workspace_id: uuid.UUID, link_id: uuid.UUID) -> PreviewLink | None:
    return db.scalar(
        select(PreviewLink)
        .join(Project, PreviewLink.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, PreviewLink.id == link_id)
        .options(*_READ_OPTIONS)
    )


def revoke_preview_link(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, link_id: uuid.UUID) -> PreviewLinkRead | None:
    link = _get_link_in_workspace(db, workspace_id, link_id)
    if link is None:
        return None

    if link.revoked_at is None:
        link.revoked_at = datetime.now(timezone.utc)
        link.revoked_by_user_id = actor_id
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=link.project_id,
            action="preview_link_revoked",
            summary=f"Revoked a {link.audience.value} preview link" + (f" ({link.label})" if link.label else ""),
        )
        db.commit()
    return _to_read(link)


# --- Public resolution: the token itself is the credential, so these
# take no workspace_id and are safe to call from an unauthenticated route. ---


def _get_link_by_token(db: Session, token: str) -> PreviewLink | None:
    return db.scalar(select(PreviewLink).where(PreviewLink.token_hash == _hash_token(token)))


def _check_link_valid(link: PreviewLink | None) -> PreviewLink:
    if link is None:
        raise HTTPException(status_code=404, detail="Preview link not found")
    if link.revoked_at is not None:
        raise HTTPException(status_code=410, detail="This preview link has been revoked")
    if link.expires_at is not None and link.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="This preview link has expired")
    return link


def _is_visible(website: Website, audience: PreviewAudience) -> bool:
    """Do-not-expose-unpublished-websites-publicly gate: a CLIENT
    audience link only ever resolves a version the operator has already
    signed off on (checkpoint 4), never a bare draft mid-build. INTERNAL
    links see every version, including drafts, for the team's own
    review — never handed to a client."""
    return website.config is not None and (audience == PreviewAudience.INTERNAL or website.approved)


def _section_read(section: dict) -> PublicPreviewSection:
    return PublicPreviewSection(id=section["id"], type=section["type"], config=section["config"])


def _to_public(link: PreviewLink, website: Website, visible_versions: list[Website]) -> PublicPreviewRead:
    config = website.config or {}
    return PublicPreviewRead(
        project_name=link.project.client.business.name,
        audience=link.audience,
        website_id=website.id,
        approved=website.approved,
        client_approved=website.client_approved,
        navigation=_section_read(config["navigation"]),
        footer=_section_read(config["footer"]),
        pages=[
            PublicPreviewPage(
                slug=page["slug"],
                name=page["name"],
                sections=[_section_read(s) for s in page["sections"]],
            )
            for page in config.get("pages", [])
        ],
        versions=[
            PreviewVersionSummary(
                id=v.id,
                label=f"Version from {v.generated_at.date().isoformat()}",
                approved=v.approved,
                client_approved=v.client_approved,
                generated_at=v.generated_at,
            )
            for v in visible_versions
        ],
    )


def resolve_link_and_website(db: Session, token: str, website_id: uuid.UUID) -> tuple[PreviewLink, Website]:
    """Shared resolution + visibility gate for anything reached through a
    preview link, not just the preview page itself — see
    modules/website_feedback/service.py's submit_feedback, which needs
    the exact version a piece of feedback was left against without
    needing every other visible version alongside it. Does not touch
    access-tracking fields; only resolve_preview (an actual page view)
    does that."""
    link = _check_link_valid(_get_link_by_token(db, token))
    website = db.scalar(select(Website).where(Website.id == website_id, Website.project_id == link.project_id))
    if website is None or not _is_visible(website, link.audience):
        raise HTTPException(status_code=404, detail="That website version isn't available on this preview link")
    return link, website


def resolve_preview(db: Session, token: str, website_id: uuid.UUID | None) -> PublicPreviewRead:
    link = _check_link_valid(_get_link_by_token(db, token))

    all_versions = db.scalars(
        select(Website).where(Website.project_id == link.project_id).order_by(Website.generated_at.desc())
    ).all()
    visible = [w for w in all_versions if _is_visible(w, link.audience)]
    if not visible:
        raise HTTPException(status_code=404, detail="No preview is available for this project yet")

    if website_id is not None:
        website = next((w for w in visible if w.id == website_id), None)
        if website is None:
            raise HTTPException(status_code=404, detail="That website version isn't available on this preview link")
    else:
        website = visible[0]

    # Access tracking, not an authorization check — best-effort bookkeeping
    # for the operator ("has the client actually opened this?").
    link.last_accessed_at = datetime.now(timezone.utc)
    link.access_count += 1
    db.commit()

    return _to_public(link, website, visible)
