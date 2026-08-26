import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.previews import service as previews_service
from app.modules.projects.models import Project
from app.modules.website_feedback.models import FeedbackStatus, FeedbackType, WebsiteFeedback
from app.modules.website_feedback.schemas import FeedbackCreate, FeedbackRead, FeedbackStatusUpdate

_READ_OPTIONS = (joinedload(WebsiteFeedback.resolved_by_user),)

_FEEDBACK_TYPE_LABEL = {
    FeedbackType.COMMENT: "a comment",
    FeedbackType.CHANGE_REQUEST: "a change request",
    FeedbackType.APPROVAL: "an approval",
    FeedbackType.REJECTION: "a rejection",
    FeedbackType.GENERAL: "general feedback",
}


def _to_read(fb: WebsiteFeedback) -> FeedbackRead:
    return FeedbackRead(
        id=fb.id,
        project_id=fb.project_id,
        website_id=fb.website_id,
        feedback_type=fb.feedback_type,
        message=fb.message,
        page_slug=fb.page_slug,
        section_id=fb.section_id,
        client_name=fb.client_name,
        client_email=fb.client_email,
        status=fb.status,
        resolved_by_user_name=fb.resolved_by_user.name if fb.resolved_by_user else None,
        resolved_at=fb.resolved_at,
        resolution_notes=fb.resolution_notes,
        created_at=fb.created_at,
    )


def submit_feedback(db: Session, token: str, website_id: uuid.UUID, request: FeedbackCreate) -> FeedbackRead:
    """Public entry point — the token is the credential, same contract as
    modules/previews/service.py's resolve_preview. A `page_slug` is
    checked against the version's own config (never trusted blind), so a
    stale reference from an old page load can't silently attach to a
    page that no longer exists on this version."""
    link, website = previews_service.resolve_link_and_website(db, token, website_id)

    if request.page_slug is not None and website.config:
        valid_slugs = {page["slug"] for page in website.config.get("pages", [])}
        if request.page_slug not in valid_slugs:
            raise HTTPException(status_code=400, detail="That page doesn't exist on this website version")

    feedback = WebsiteFeedback(
        project_id=link.project_id,
        website_id=website.id,
        preview_link_id=link.id,
        page_slug=request.page_slug,
        section_id=request.section_id,
        feedback_type=request.feedback_type,
        message=request.message,
        client_name=request.client_name,
        client_email=request.client_email,
    )
    db.add(feedback)
    db.flush()

    workspace_id = link.project.client.business.workspace_id
    who = request.client_name or ("the client" if link.audience.value == "client" else "an internal reviewer")
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=None,
        entity_type="project",
        entity_id=link.project_id,
        action="website_feedback_submitted",
        summary=f"{who} left {_FEEDBACK_TYPE_LABEL[request.feedback_type]} on the website preview",
    )
    db.commit()
    db.refresh(feedback)
    return _to_read(feedback)


def _project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Project.id == project_id)
    )


def list_feedback(
    db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID, website_id: uuid.UUID | None = None
) -> list[FeedbackRead] | None:
    project = _project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None

    query = select(WebsiteFeedback).where(WebsiteFeedback.project_id == project_id).options(*_READ_OPTIONS)
    if website_id is not None:
        query = query.where(WebsiteFeedback.website_id == website_id)
    items = db.scalars(query.order_by(WebsiteFeedback.created_at.desc()))
    return [_to_read(f) for f in items]


def _get_feedback_in_workspace(db: Session, workspace_id: uuid.UUID, feedback_id: uuid.UUID) -> WebsiteFeedback | None:
    return db.scalar(
        select(WebsiteFeedback)
        .join(Project, WebsiteFeedback.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, WebsiteFeedback.id == feedback_id)
        .options(*_READ_OPTIONS)
    )


def update_feedback_status(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, feedback_id: uuid.UUID, request: FeedbackStatusUpdate
) -> FeedbackRead | None:
    feedback = _get_feedback_in_workspace(db, workspace_id, feedback_id)
    if feedback is None:
        return None

    feedback.status = request.status
    if request.status in (FeedbackStatus.RESOLVED, FeedbackStatus.DISMISSED):
        feedback.resolved_by_user_id = actor_id
        feedback.resolved_at = datetime.now(timezone.utc)
    if request.resolution_notes is not None:
        feedback.resolution_notes = request.resolution_notes

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=feedback.project_id,
        action="website_feedback_status_updated",
        summary=f"Marked feedback as {request.status.value}",
    )
    db.commit()
    return _to_read(feedback)
