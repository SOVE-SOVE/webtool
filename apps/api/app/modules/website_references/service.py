import asyncio
import base64
import ipaddress
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import func, select
from sqlalchemy.orm import Session, undefer

from app.integrations import browser
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import JOB_WEBSITE_REFERENCE_CAPTURE
from app.modules.jobs.models import Job, JobStatus
from app.modules.website_references.models import (
    LeadPlanningReference,
    ReferenceCaptureStatus,
    WebsiteReference,
)
from app.modules.website_references.schemas import (
    CreateWebsiteReferenceRequest,
    UpdateWebsiteReferenceRequest,
    WebsiteReferenceRead,
)

MAX_TAGS = 12
MAX_TAG_LENGTH = 30


class InvalidReferenceUrlError(ValueError):
    pass


class DuplicateReferenceError(ValueError):
    def __init__(self, existing: WebsiteReference):
        super().__init__(f"Already in the library as “{existing.name}”.")
        self.existing = existing


class ReferenceInUseError(ValueError):
    pass


def normalize_url(raw: str) -> tuple[str, str]:
    """(url to store, normalised key). Adds https:// when no scheme is
    given; only public-looking http(s) URLs are accepted here — the
    capture job re-checks every address the browser actually contacts."""
    value = raw.strip()
    if "://" not in value:
        value = f"https://{value}"
    parts = urlsplit(value)
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise InvalidReferenceUrlError("Only http and https websites can be saved.")
    host = (parts.hostname or "").lower().rstrip(".")
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local") or host.endswith(".internal"):
        raise InvalidReferenceUrlError("Local or internal addresses can't be saved as references.")
    if not host or "." not in host and not host.startswith("["):
        raise InvalidReferenceUrlError("That doesn't look like a website address.")
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None and not literal.is_global:
        raise InvalidReferenceUrlError("Private or internal addresses can't be saved as references.")
    if parts.username or parts.password:
        raise InvalidReferenceUrlError("Addresses with embedded credentials can't be saved.")
    port = parts.port
    netloc = host if port is None or (scheme, port) in (("http", 80), ("https", 443)) else f"{host}:{port}"
    path = parts.path or "/"
    stored = urlunsplit((scheme, netloc, path, parts.query, ""))
    key_host = host[4:] if host.startswith("www.") else host
    key_path = path.rstrip("/") or ""
    key = urlunsplit(("", key_host + (f":{port}" if netloc != host else ""), key_path, parts.query, "")).lstrip("/")
    return stored, key


def _clean_tags(tags: list[str]) -> list[str]:
    seen: list[str] = []
    for tag in tags:
        t = tag.strip().lower()[:MAX_TAG_LENGTH]
        if t and t not in seen:
            seen.append(t)
    return seen[:MAX_TAGS]


def _usage_counts(db: Session, reference_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not reference_ids:
        return {}
    rows = db.execute(
        select(LeadPlanningReference.reference_id, func.count())
        .where(LeadPlanningReference.reference_id.in_(reference_ids))
        .group_by(LeadPlanningReference.reference_id)
    ).all()
    return {rid: count for rid, count in rows}


def _has_screenshot(db: Session, reference_id: uuid.UUID) -> bool:
    return bool(
        db.scalar(select(WebsiteReference.screenshot_base64.isnot(None)).where(WebsiteReference.id == reference_id))
    )


def to_read(db: Session, reference: WebsiteReference, usage: int | None = None) -> WebsiteReferenceRead:
    data = WebsiteReferenceRead.model_validate(reference)
    data.has_screenshot = reference.screenshot_captured_at is not None and _has_screenshot(db, reference.id)
    data.usage_count = usage if usage is not None else _usage_counts(db, [reference.id]).get(reference.id, 0)
    return data


def _get(db: Session, workspace_id: uuid.UUID, reference_id: uuid.UUID) -> WebsiteReference | None:
    return db.scalar(
        select(WebsiteReference).where(WebsiteReference.workspace_id == workspace_id, WebsiteReference.id == reference_id)
    )


def list_references(
    db: Session, workspace_id: uuid.UUID, *, q: str | None = None, tag: str | None = None, include_archived: bool = False
) -> list[WebsiteReferenceRead]:
    stmt = select(WebsiteReference).where(WebsiteReference.workspace_id == workspace_id)
    if not include_archived:
        stmt = stmt.where(WebsiteReference.archived_at.is_(None))
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            func.lower(WebsiteReference.name).like(like)
            | func.lower(WebsiteReference.url).like(like)
            | func.lower(func.coalesce(WebsiteReference.notes, "")).like(like)
        )
    references = list(db.scalars(stmt.order_by(WebsiteReference.created_at.desc())))
    if tag:
        wanted = tag.strip().lower()
        references = [r for r in references if wanted in (r.tags or [])]
    usage = _usage_counts(db, [r.id for r in references])
    with_shots = set(
        db.scalars(
            select(WebsiteReference.id).where(
                WebsiteReference.id.in_([r.id for r in references]), WebsiteReference.screenshot_base64.isnot(None)
            )
        )
    ) if references else set()
    out = []
    for r in references:
        data = WebsiteReferenceRead.model_validate(r)
        data.has_screenshot = r.id in with_shots
        data.usage_count = usage.get(r.id, 0)
        out.append(data)
    return out


def _has_pending_capture(db: Session, workspace_id: uuid.UUID, reference_id: uuid.UUID) -> bool:
    jobs = db.scalars(
        select(Job).where(
            Job.workspace_id == workspace_id,
            Job.job_type == JOB_WEBSITE_REFERENCE_CAPTURE,
            Job.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
        )
    )
    return any(j.payload.get("reference_id") == str(reference_id) for j in jobs)


def _enqueue_capture(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, reference: WebsiteReference) -> None:
    reference.capture_status = ReferenceCaptureStatus.PENDING
    reference.capture_error = None
    db.flush()
    if not _has_pending_capture(db, workspace_id, reference.id):
        jobs_service.enqueue(
            db,
            workspace_id=workspace_id,
            job_type=JOB_WEBSITE_REFERENCE_CAPTURE,
            payload={"reference_id": str(reference.id)},
            actor_id=actor_id,
        )


def create_reference(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: CreateWebsiteReferenceRequest
) -> tuple[WebsiteReferenceRead, bool]:
    """(reference, created). An archived duplicate is restored rather than
    duplicated; an active duplicate raises DuplicateReferenceError."""
    stored, key = normalize_url(data.url)
    existing = db.scalar(
        select(WebsiteReference).where(
            WebsiteReference.workspace_id == workspace_id, WebsiteReference.normalized_url == key
        )
    )
    if existing is not None:
        if existing.archived_at is None:
            raise DuplicateReferenceError(existing)
        existing.archived_at = None
        db.commit()
        db.refresh(existing)
        return to_read(db, existing), False

    name = (data.name or "").strip() or (urlsplit(stored).hostname or stored).removeprefix("www.")
    reference = WebsiteReference(
        workspace_id=workspace_id,
        url=stored,
        normalized_url=key,
        name=name[:200],
        tags=_clean_tags(data.tags),
        notes=(data.notes or "").strip() or None,
        created_by_user_id=actor_id,
    )
    db.add(reference)
    db.flush()
    _enqueue_capture(db, workspace_id, actor_id, reference)
    db.commit()
    db.refresh(reference)
    return to_read(db, reference), True


def update_reference(
    db: Session, workspace_id: uuid.UUID, reference_id: uuid.UUID, data: UpdateWebsiteReferenceRequest
) -> WebsiteReferenceRead | None:
    reference = _get(db, workspace_id, reference_id)
    if reference is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    if "name" in fields and fields["name"] is not None:
        reference.name = fields["name"].strip()[:200] or reference.name
    if "tags" in fields and fields["tags"] is not None:
        reference.tags = _clean_tags(fields["tags"])
    if "notes" in fields:
        reference.notes = (fields["notes"] or "").strip() or None
    db.commit()
    db.refresh(reference)
    return to_read(db, reference)


def retry_capture(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, reference_id: uuid.UUID
) -> WebsiteReferenceRead | None:
    reference = _get(db, workspace_id, reference_id)
    if reference is None:
        return None
    _enqueue_capture(db, workspace_id, actor_id, reference)
    db.commit()
    db.refresh(reference)
    return to_read(db, reference)


def set_archived(db: Session, workspace_id: uuid.UUID, reference_id: uuid.UUID, archived: bool) -> WebsiteReferenceRead | None:
    reference = _get(db, workspace_id, reference_id)
    if reference is None:
        return None
    reference.archived_at = datetime.now(timezone.utc) if archived else None
    db.commit()
    db.refresh(reference)
    return to_read(db, reference)


def delete_reference(db: Session, workspace_id: uuid.UUID, reference_id: uuid.UUID) -> bool | None:
    """Hard delete only when no plan uses it — otherwise ReferenceInUseError
    (archive instead), so no plan silently loses an attachment."""
    reference = _get(db, workspace_id, reference_id)
    if reference is None:
        return None
    usage = _usage_counts(db, [reference.id]).get(reference.id, 0)
    if usage:
        raise ReferenceInUseError(
            f"Used by {usage} plan{'s' if usage != 1 else ''} — archive it instead, or remove it from those plans first."
        )
    db.delete(reference)
    db.commit()
    return True


def get_screenshot(db: Session, workspace_id: uuid.UUID, reference_id: uuid.UUID) -> tuple[bytes, datetime] | None:
    reference = db.scalar(
        select(WebsiteReference)
        .options(undefer(WebsiteReference.screenshot_base64))
        .where(WebsiteReference.workspace_id == workspace_id, WebsiteReference.id == reference_id)
    )
    if reference is None or not reference.screenshot_base64 or reference.screenshot_captured_at is None:
        return None
    return base64.b64decode(reference.screenshot_base64), reference.screenshot_captured_at


def run_capture_job(db: Session, reference_id: uuid.UUID) -> dict:
    """The background capture. A failure is recorded on the row and the
    job still completes — never raised — so the queue's automatic retries
    can't loop on a site that blocks us; retrying is an explicit action."""
    reference = db.get(WebsiteReference, reference_id)
    if reference is None:
        return {"skipped": "reference not found"}
    result = asyncio.run(browser.capture_reference_screenshot(reference.url))
    if result.screenshot_jpeg:
        reference.screenshot_base64 = base64.b64encode(result.screenshot_jpeg).decode("ascii")
        reference.screenshot_captured_at = datetime.now(timezone.utc)
        reference.capture_status = ReferenceCaptureStatus.CAPTURED
        reference.capture_error = None
    else:
        reference.capture_status = ReferenceCaptureStatus.FAILED
        reference.capture_error = result.error or "The preview couldn't be captured."
    db.commit()
    return {"reference_id": str(reference_id), "status": reference.capture_status.value}
