import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.planning import service as planning_service
from app.modules.planning.schemas import PlanningRead
from app.modules.users.models import User
from app.modules.website_references import service
from app.modules.website_references.models import LeadPlanningReference
from app.modules.website_references.schemas import (
    AttachReferenceRequest,
    CreateWebsiteReferenceRequest,
    UpdatePlanningReferenceRequest,
    UpdateWebsiteReferenceRequest,
    WebsiteReferenceRead,
)

router = APIRouter(tags=["website-references"])


# --- Shared library (workspace-scoped) ---------------------------------------


@router.get("/api/v1/website-references", response_model=list[WebsiteReferenceRead])
def list_references(
    q: str | None = Query(default=None, max_length=200),
    tag: str | None = Query(default=None, max_length=30),
    include_archived: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WebsiteReferenceRead]:
    return service.list_references(db, current_user.workspace_id, q=q, tag=tag, include_archived=include_archived)


@router.post("/api/v1/website-references", response_model=WebsiteReferenceRead)
def create_reference(
    body: CreateWebsiteReferenceRequest,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteReferenceRead:
    """Saves the URL/name/tags/notes straight away and queues ONE guarded
    preview capture in the background — the entry is usable even if the
    capture later fails ("Preview unavailable" + explicit retry)."""
    try:
        reference, created = service.create_reference(db, current_user.workspace_id, current_user.id, body)
    except service.InvalidReferenceUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except service.DuplicateReferenceError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    response.status_code = 201 if created else 200
    return reference


@router.patch("/api/v1/website-references/{reference_id}", response_model=WebsiteReferenceRead)
def update_reference(
    reference_id: uuid.UUID,
    body: UpdateWebsiteReferenceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteReferenceRead:
    reference = service.update_reference(db, current_user.workspace_id, reference_id, body)
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference not found")
    return reference


@router.post("/api/v1/website-references/{reference_id}/capture", response_model=WebsiteReferenceRead)
def retry_capture(
    reference_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteReferenceRead:
    """Explicit retry — never automatic. A second click while one is queued
    doesn't stack another job."""
    reference = service.retry_capture(db, current_user.workspace_id, current_user.id, reference_id)
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference not found")
    return reference


@router.post("/api/v1/website-references/{reference_id}/archive", response_model=WebsiteReferenceRead)
def archive_reference(
    reference_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> WebsiteReferenceRead:
    reference = service.set_archived(db, current_user.workspace_id, reference_id, True)
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference not found")
    return reference


@router.post("/api/v1/website-references/{reference_id}/unarchive", response_model=WebsiteReferenceRead)
def unarchive_reference(
    reference_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> WebsiteReferenceRead:
    reference = service.set_archived(db, current_user.workspace_id, reference_id, False)
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference not found")
    return reference


@router.delete("/api/v1/website-references/{reference_id}", status_code=204)
def delete_reference(
    reference_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    try:
        removed = service.delete_reference(db, current_user.workspace_id, reference_id)
    except service.ReferenceInUseError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if removed is None:
        raise HTTPException(status_code=404, detail="Reference not found")
    return Response(status_code=204)


@router.get("/api/v1/website-references/{reference_id}/screenshot")
def get_screenshot(
    reference_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """The stored preview — never a fresh fetch of the site. Cached privately
    in the browser, keyed on the capture time, so browsing doesn't re-download."""
    found = service.get_screenshot(db, current_user.workspace_id, reference_id)
    if found is None:
        raise HTTPException(status_code=404, detail="No preview available")
    image, captured_at = found
    etag = f'"{int(captured_at.timestamp())}"'
    headers = {"Cache-Control": "private, max-age=86400", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=image, media_type="image/jpeg", headers=headers)


# --- Attachments on a plan -----------------------------------------------------


def _planning_or_404(db: Session, workspace_id: uuid.UUID, planning_id: uuid.UUID):
    planning = planning_service._get_planning(db, workspace_id, planning_id)
    if planning is None:
        raise HTTPException(status_code=404, detail="Planning item not found")
    return planning


@router.post("/api/v1/planning/{planning_id}/references", response_model=PlanningRead)
def attach_reference(
    planning_id: uuid.UUID,
    body: AttachReferenceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Idempotent: attaching one already on this plan is a no-op."""
    planning = _planning_or_404(db, current_user.workspace_id, planning_id)
    reference = service._get(db, current_user.workspace_id, body.reference_id)
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference not found")
    if not any(a.reference_id == reference.id for a in planning.inspiration_references):
        if reference.archived_at is not None:
            raise HTTPException(status_code=400, detail="That reference is archived — restore it first.")
        order = max((a.order_index for a in planning.inspiration_references), default=-1) + 1
        db.add(LeadPlanningReference(lead_planning_id=planning.id, reference_id=reference.id, order_index=order))
        db.commit()
    db.expire_all()
    return planning_service._to_read(db, _planning_or_404(db, current_user.workspace_id, planning_id))


def _attachment_or_404(db: Session, planning, attachment_id: uuid.UUID) -> LeadPlanningReference:
    attachment = db.scalar(
        select(LeadPlanningReference).where(
            LeadPlanningReference.id == attachment_id, LeadPlanningReference.lead_planning_id == planning.id
        )
    )
    if attachment is None:
        raise HTTPException(status_code=404, detail="Reference isn't attached to this plan")
    return attachment


@router.patch("/api/v1/planning/{planning_id}/references/{attachment_id}", response_model=PlanningRead)
def update_attachment(
    planning_id: uuid.UUID,
    attachment_id: uuid.UUID,
    body: UpdatePlanningReferenceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    planning = _planning_or_404(db, current_user.workspace_id, planning_id)
    attachment = _attachment_or_404(db, planning, attachment_id)
    fields = body.model_dump(exclude_unset=True)
    if "direction" in fields:
        attachment.direction = (fields["direction"] or "").strip() or None
    if fields.get("liked_aspects") is not None:
        attachment.liked_aspects = list(dict.fromkeys(fields["liked_aspects"]))
    db.commit()
    db.expire_all()
    return planning_service._to_read(db, _planning_or_404(db, current_user.workspace_id, planning_id))


@router.delete("/api/v1/planning/{planning_id}/references/{attachment_id}", response_model=PlanningRead)
def detach_reference(
    planning_id: uuid.UUID,
    attachment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanningRead:
    """Removes it from this plan only — the shared reference is untouched."""
    planning = _planning_or_404(db, current_user.workspace_id, planning_id)
    attachment = _attachment_or_404(db, planning, attachment_id)
    db.delete(attachment)
    db.commit()
    db.expire_all()
    return planning_service._to_read(db, _planning_or_404(db, current_user.workspace_id, planning_id))
