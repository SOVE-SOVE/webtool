import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import exists, select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.checklists import shared
from app.modules.checklists.models import ChecklistCompletionMode, ChecklistItemStatus
from app.modules.checklists.schemas import ChecklistCompletedBy
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.leads.models import Lead
from app.modules.planning.models import LeadPlanning
from app.modules.projects.models import Project
from app.modules.stage_checklists import signals
from app.modules.stage_checklists.models import StageChecklistAutoSignal, StageChecklistItem
from app.modules.stage_checklists.schemas import (
    AddStageChecklistItemRequest,
    ReorderStageChecklistItemsRequest,
    StageChecklistItemRead,
    StageChecklistNextAction,
    StageChecklistProgress,
    StageChecklistProgressPart,
    StageChecklistRead,
    UpdateStageChecklistItemRequest,
)
from app.modules.users.service import require_user_in_workspace

# Default tasks per stage (title, completion_mode, auto_signal) —
# docs/05_DECISIONS.md. Every "review X" task's auto_signal (when set)
# only drives a read-time needs_review flip once already marked complete
# (see _to_read) — it never auto-completes a MANUAL row. Only Planning's
# build-brief approval and the 3 Project items are genuinely AUTOMATIC,
# reusing real signals the way the existing Client Delivery checklist
# already does. Every default task is is_required=True; custom tasks
# default to optional (docs/05_DECISIONS.md).
DEFAULT_DISCOVERY_TASKS: list[tuple[str, ChecklistCompletionMode, StageChecklistAutoSignal | None]] = [
    ("Confirm business identity and location", ChecklistCompletionMode.MANUAL, None),
    ("Review website/social presence", ChecklistCompletionMode.MANUAL, StageChecklistAutoSignal.DISCOVERY_SITE_REVIEW),
    ("Review suitability as a prospect", ChecklistCompletionMode.MANUAL, StageChecklistAutoSignal.DISCOVERY_SCORE),
]

DEFAULT_LEAD_TASKS: list[tuple[str, ChecklistCompletionMode, StageChecklistAutoSignal | None]] = [
    ("Confirm business and contact details", ChecklistCompletionMode.MANUAL, None),
    ("Review available research", ChecklistCompletionMode.MANUAL, StageChecklistAutoSignal.LEAD_RESEARCH),
    ("Confirm prospect suitability", ChecklistCompletionMode.MANUAL, None),
    ("Ready to start Planning", ChecklistCompletionMode.MANUAL, None),
]

DEFAULT_PLANNING_TASKS: list[tuple[str, ChecklistCompletionMode, StageChecklistAutoSignal | None]] = [
    ("Review website audit or new-website research", ChecklistCompletionMode.MANUAL, StageChecklistAutoSignal.PLANNING_AUDIT),
    ("Review Google Review Insights, where available", ChecklistCompletionMode.MANUAL, StageChecklistAutoSignal.PLANNING_REVIEW_INSIGHTS),
    ("Review improvement recommendations", ChecklistCompletionMode.MANUAL, StageChecklistAutoSignal.PLANNING_RECOMMENDATIONS),
    ("Select website structure and direction", ChecklistCompletionMode.MANUAL, StageChecklistAutoSignal.PLANNING_STRUCTURE),
    ("Review content and asset requirements", ChecklistCompletionMode.MANUAL, StageChecklistAutoSignal.PLANNING_ASSETS),
    ("Approve the build brief", ChecklistCompletionMode.AUTOMATIC, StageChecklistAutoSignal.PLANNING_BUILD_BRIEF_APPROVED),
]

DEFAULT_PROJECT_STAGE_TASKS: list[tuple[str, ChecklistCompletionMode, StageChecklistAutoSignal | None]] = [
    ("Review build inputs", ChecklistCompletionMode.MANUAL, None),
    ("Generate first preview", ChecklistCompletionMode.AUTOMATIC, StageChecklistAutoSignal.PROJECT_PREVIEW_BUILT),
    ("Review desktop and mobile", ChecklistCompletionMode.MANUAL, None),
    ("Complete revisions", ChecklistCompletionMode.MANUAL, None),
    ("Complete QA", ChecklistCompletionMode.AUTOMATIC, StageChecklistAutoSignal.PROJECT_QA_COMPLETE),
    ("Approve the website for presentation or launch", ChecklistCompletionMode.AUTOMATIC, StageChecklistAutoSignal.PROJECT_LAUNCH_APPROVED),
]

_SIGNAL_LABELS = {
    StageChecklistAutoSignal.DISCOVERY_SITE_REVIEW: "The website/social research",
    StageChecklistAutoSignal.DISCOVERY_SCORE: "The opportunity score",
    StageChecklistAutoSignal.LEAD_RESEARCH: "The website/sales audit",
    StageChecklistAutoSignal.PLANNING_AUDIT: "The website audit",
    StageChecklistAutoSignal.PLANNING_REVIEW_INSIGHTS: "Google Review Insights",
    StageChecklistAutoSignal.PLANNING_RECOMMENDATIONS: "The improvement recommendations",
    StageChecklistAutoSignal.PLANNING_STRUCTURE: "The sitemap/visual direction",
    StageChecklistAutoSignal.PLANNING_ASSETS: "The assets/content draft",
}

_OWNER_COLUMNS = ("discovered_business_id", "lead_id", "lead_planning_id", "project_id")


def _owner_field_and_id(item: StageChecklistItem) -> tuple[str, uuid.UUID]:
    for field in _OWNER_COLUMNS:
        value = getattr(item, field)
        if value is not None:
            return field, value
    raise AssertionError("StageChecklistItem row has no owner set")


# --- Idempotent seeding, one per stage --------------------------------------------


def _seed(db: Session, owner_field: str, owner_id: uuid.UUID, defaults: list[tuple]) -> None:
    already_seeded = db.scalar(select(exists().where(getattr(StageChecklistItem, owner_field) == owner_id)))
    if already_seeded:
        return
    for i, (title, mode, signal) in enumerate(defaults):
        db.add(
            StageChecklistItem(
                **{owner_field: owner_id},
                title=title,
                order_index=i,
                is_default=True,
                is_required=True,
                completion_mode=mode,
                auto_signal=signal,
            )
        )
    # Flushed (not committed — the caller's transaction owns that), same
    # convention as checklists/service.py's initialise_* functions.
    db.flush()


def initialise_discovery_checklist(db: Session, discovered_business_id: uuid.UUID) -> None:
    _seed(db, "discovered_business_id", discovered_business_id, DEFAULT_DISCOVERY_TASKS)


def initialise_lead_checklist(db: Session, lead_id: uuid.UUID) -> None:
    _seed(db, "lead_id", lead_id, DEFAULT_LEAD_TASKS)


def initialise_planning_checklist(db: Session, lead_planning_id: uuid.UUID) -> None:
    _seed(db, "lead_planning_id", lead_planning_id, DEFAULT_PLANNING_TASKS)


def initialise_project_stage_checklist(db: Session, project_id: uuid.UUID) -> None:
    _seed(db, "project_id", project_id, DEFAULT_PROJECT_STAGE_TASKS)


# --- Workspace-scoped owner lookups ------------------------------------------------


def _get_discovered_business_in_workspace(db: Session, workspace_id: uuid.UUID, discovered_business_id: uuid.UUID) -> DiscoveredBusiness | None:
    return db.scalar(
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id == discovered_business_id)
    )


def _get_lead_in_workspace(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> Lead | None:
    return db.scalar(
        select(Lead).join(Business, Lead.business_id == Business.id).where(Business.workspace_id == workspace_id, Lead.id == lead_id)
    )


def _get_planning_in_workspace(db: Session, workspace_id: uuid.UUID, lead_planning_id: uuid.UUID) -> LeadPlanning | None:
    return db.scalar(
        select(LeadPlanning)
        .join(Lead, LeadPlanning.lead_id == Lead.id)
        .join(Business, Lead.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, LeadPlanning.id == lead_planning_id)
    )


def _get_project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(select(Project).where(Project.workspace_id == workspace_id, Project.id == project_id))


_OWNER_LOOKUPS = {
    "discovered_business_id": _get_discovered_business_in_workspace,
    "lead_id": _get_lead_in_workspace,
    "lead_planning_id": _get_planning_in_workspace,
    "project_id": _get_project_in_workspace,
}


def _get_item_in_workspace(db: Session, workspace_id: uuid.UUID, item_id: uuid.UUID) -> StageChecklistItem | None:
    item = db.get(
        StageChecklistItem,
        item_id,
        options=[joinedload(StageChecklistItem.completed_by_user), joinedload(StageChecklistItem.assigned_user)],
    )
    if item is None:
        return None
    owner_field, owner_id = _owner_field_and_id(item)
    if _OWNER_LOOKUPS[owner_field](db, workspace_id, owner_id) is None:
        return None
    return item


# --- Read + live status resolution -------------------------------------------------


def _to_read(item: StageChecklistItem, live: signals.SignalResult | None) -> StageChecklistItemRead:
    completed_by_user = (
        ChecklistCompletedBy(type="user", name=item.completed_by_user.name) if item.completed_by_user else None
    )
    assigned_user_name = item.assigned_user.name if item.assigned_user else None
    base = dict(
        id=item.id,
        title=item.title,
        order_index=item.order_index,
        is_default=item.is_default,
        is_required=item.is_required,
        completion_mode=item.completion_mode.value,
        assigned_user_id=item.assigned_user_id,
        assigned_user_name=assigned_user_name,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )

    if item.status in (ChecklistItemStatus.NOT_REQUIRED, ChecklistItemStatus.BLOCKED):
        return StageChecklistItemRead(
            **base,
            status=item.status.value,
            completed_at=item.completed_at,
            completed_by=completed_by_user,
            link=live.link if live else None,
            blocked_reason=item.blocked_reason if item.status == ChecklistItemStatus.BLOCKED else None,
            needs_review_reason=None,
        )

    if item.completion_mode == ChecklistCompletionMode.AUTOMATIC:
        assert live is not None
        return StageChecklistItemRead(
            **base,
            status="complete" if live.done else "pending",
            completed_at=live.completed_at if live.done else None,
            completed_by=live.completed_by if live.done else None,
            link=live.link,
            blocked_reason=None,
            needs_review_reason=None,
        )

    # MANUAL — stored status is authoritative, except a needs_review flip
    # computed fresh every read when the item was already completed and
    # its linked signal has changed since (never stored, same discipline
    # as an AUTOMATIC item's live-computed completion).
    stored = (item.status or ChecklistItemStatus.PENDING).value
    effective = stored
    needs_review_reason = None
    if item.auto_signal is not None and live is not None:
        result = shared.resolve_manual_review_status(
            stored_status=stored,
            item_completed_at=item.completed_at,
            live_completed_at=live.completed_at,
            signal_label=_SIGNAL_LABELS.get(item.auto_signal, "The underlying evidence"),
        )
        effective = result.effective_status
        needs_review_reason = result.needs_review_reason

    return StageChecklistItemRead(
        **base,
        status=effective,
        completed_at=item.completed_at,
        completed_by=completed_by_user,
        link=live.link if live else None,
        blocked_reason=None,
        needs_review_reason=needs_review_reason,
    )


def _progress(items: list[StageChecklistItemRead]) -> StageChecklistProgress:
    split = shared.compute_progress_split([(i.status, i.is_required) for i in items])
    return StageChecklistProgress(
        required=StageChecklistProgressPart(completed=split.required.completed, total=split.required.total, pct=split.required.pct),
        optional=StageChecklistProgressPart(completed=split.optional.completed, total=split.optional.total, pct=split.optional.pct),
    )


def _next_item(items: list[StageChecklistItemRead]) -> StageChecklistItemRead | None:
    ordered = sorted(items, key=lambda i: i.order_index)
    return next((i for i in ordered if i.status in ("pending", "needs_review")), None)


def _next_action(items: list[StageChecklistItemRead]) -> StageChecklistNextAction:
    candidates = [
        shared.NextActionCandidate(
            id=i.id,
            title=i.title,
            status=i.status,
            is_required=i.is_required,
            order_index=i.order_index,
            link=i.link,
            assigned_user_name=i.assigned_user_name,
            blocked_reason=i.blocked_reason,
        )
        for i in items
    ]
    result = shared.select_next_action(candidates)
    by_id = {i.id: i for i in items}
    if result.kind == "task" and result.item is not None:
        return StageChecklistNextAction(kind="task", item=by_id[result.item.id])
    if result.kind == "blocked" and result.items:
        return StageChecklistNextAction(kind="blocked", items=[by_id[c.id] for c in result.items])
    return StageChecklistNextAction(kind="done")


def _read_checklist(db: Session, owner_field: str, owner_id: uuid.UUID) -> StageChecklistRead:
    rows = list(
        db.scalars(
            select(StageChecklistItem)
            .where(getattr(StageChecklistItem, owner_field) == owner_id)
            .options(joinedload(StageChecklistItem.completed_by_user), joinedload(StageChecklistItem.assigned_user))
            .order_by(StageChecklistItem.order_index)
        )
    )
    needed_signals = {
        r.auto_signal for r in rows if r.auto_signal is not None and r.status not in (ChecklistItemStatus.NOT_REQUIRED, ChecklistItemStatus.BLOCKED)
    }
    live_by_signal = signals.resolve_all(db, needed_signals, owner_id) if needed_signals else {}
    item_reads = [_to_read(r, live_by_signal.get(r.auto_signal)) for r in rows]
    return StageChecklistRead(
        items=item_reads,
        progress=_progress(item_reads),
        next_item=_next_item(item_reads),
        next_action=_next_action(item_reads),
    )


# --- Public per-stage read entrypoints ---------------------------------------------


def get_discovery_checklist(db: Session, workspace_id: uuid.UUID, discovered_business_id: uuid.UUID) -> StageChecklistRead | None:
    if _get_discovered_business_in_workspace(db, workspace_id, discovered_business_id) is None:
        return None
    initialise_discovery_checklist(db, discovered_business_id)
    db.commit()
    return _read_checklist(db, "discovered_business_id", discovered_business_id)


def get_lead_checklist(db: Session, workspace_id: uuid.UUID, lead_id: uuid.UUID) -> StageChecklistRead | None:
    if _get_lead_in_workspace(db, workspace_id, lead_id) is None:
        return None
    initialise_lead_checklist(db, lead_id)
    db.commit()
    return _read_checklist(db, "lead_id", lead_id)


def get_planning_checklist(db: Session, workspace_id: uuid.UUID, lead_planning_id: uuid.UUID) -> StageChecklistRead | None:
    if _get_planning_in_workspace(db, workspace_id, lead_planning_id) is None:
        return None
    initialise_planning_checklist(db, lead_planning_id)
    db.commit()
    return _read_checklist(db, "lead_planning_id", lead_planning_id)


def get_project_stage_checklist(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> StageChecklistRead | None:
    if _get_project_in_workspace(db, workspace_id, project_id) is None:
        return None
    initialise_project_stage_checklist(db, project_id)
    db.commit()
    return _read_checklist(db, "project_id", project_id)


_READERS = {
    "discovered_business_id": get_discovery_checklist,
    "lead_id": get_lead_checklist,
    "lead_planning_id": get_planning_checklist,
    "project_id": get_project_stage_checklist,
}


def _get_checklist_for_item(db: Session, workspace_id: uuid.UUID, item: StageChecklistItem) -> StageChecklistRead | None:
    owner_field, owner_id = _owner_field_and_id(item)
    return _READERS[owner_field](db, workspace_id, owner_id)


# --- Mutations -----------------------------------------------------------------


def add_item(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    owner_field: str,
    owner_id: uuid.UUID,
    data: AddStageChecklistItemRequest,
) -> StageChecklistRead | None:
    if _OWNER_LOOKUPS[owner_field](db, workspace_id, owner_id) is None:
        return None
    if data.assigned_user_id is not None:
        require_user_in_workspace(db, workspace_id, data.assigned_user_id)

    siblings = db.scalars(select(StageChecklistItem).where(getattr(StageChecklistItem, owner_field) == owner_id)).all()
    next_order = (max((s.order_index for s in siblings), default=-1)) + 1

    item = StageChecklistItem(
        **{owner_field: owner_id},
        title=data.title,
        order_index=next_order,
        is_default=False,
        is_required=False,
        completion_mode=ChecklistCompletionMode.MANUAL,
        status=ChecklistItemStatus.PENDING,
        assigned_user_id=data.assigned_user_id,
    )
    db.add(item)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="stage_checklist_item",
        entity_id=item.id,
        action="created",
        summary=f'Added stage checklist task "{data.title}"',
    )
    db.commit()
    return _READERS[owner_field](db, workspace_id, owner_id)


def update_item(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, item_id: uuid.UUID, data: UpdateStageChecklistItemRequest
) -> StageChecklistRead | None:
    item = _get_item_in_workspace(db, workspace_id, item_id)
    if item is None:
        return None

    if data.title is not None:
        item.title = data.title

    if "assigned_user_id" in data.model_fields_set and data.assigned_user_id != item.assigned_user_id:
        if data.assigned_user_id is not None:
            require_user_in_workspace(db, workspace_id, data.assigned_user_id)
        item.assigned_user_id = data.assigned_user_id
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="stage_checklist_item",
            entity_id=item.id,
            action="assigned",
            summary="Unassigned" if data.assigned_user_id is None else "Reassigned",
        )

    note = data.note.strip() if data.note else None
    note_suffix = f" — {note}" if note else ""

    owner_field, owner_id = _owner_field_and_id(item)

    if data.status is not None:
        new_status = ChecklistItemStatus(data.status)
        live = signals.resolve(db, item.auto_signal, owner_id) if item.auto_signal is not None else None
        current = _to_read(item, live)

        if item.completion_mode == ChecklistCompletionMode.AUTOMATIC and new_status not in (
            ChecklistItemStatus.NOT_REQUIRED,
            ChecklistItemStatus.PENDING,
            ChecklistItemStatus.BLOCKED,
        ):
            raise HTTPException(
                status_code=400,
                detail="Automatic tasks can only be marked Not required or Blocked — their completion is detected, not toggled.",
            )

        if new_status == ChecklistItemStatus.BLOCKED:
            if not data.blocked_reason or not data.blocked_reason.strip():
                raise HTTPException(status_code=400, detail="A reason is required to mark a task blocked.")
            if current.status in ("complete", "not_required"):
                raise HTTPException(status_code=400, detail="Only an incomplete task can be marked blocked.")
            item.status = ChecklistItemStatus.BLOCKED
            item.blocked_reason = data.blocked_reason.strip()
            activity_service.record(
                db,
                workspace_id=workspace_id,
                user_id=actor_id,
                entity_type="stage_checklist_item",
                entity_id=item.id,
                action="blocked",
                summary=f'Blocked "{item.title}" — {item.blocked_reason}{note_suffix}',
            )
        else:
            was_blocked = item.status == ChecklistItemStatus.BLOCKED
            was_complete_or_not_required = item.status in (ChecklistItemStatus.COMPLETE, ChecklistItemStatus.NOT_REQUIRED)
            item.status = new_status
            if was_blocked and new_status != ChecklistItemStatus.BLOCKED:
                item.blocked_reason = None

            if new_status == ChecklistItemStatus.COMPLETE:
                item.completed_at = datetime.now(timezone.utc)
                item.completed_by_user_id = actor_id
                version_suffix = ""
                if item.completion_mode == ChecklistCompletionMode.MANUAL and item.auto_signal is not None:
                    live_now = signals.resolve(db, item.auto_signal, owner_id)
                    if live_now.completed_at:
                        label = _SIGNAL_LABELS.get(item.auto_signal, "the underlying evidence")
                        version_suffix = f" (reviewed {label.lower()} as of {live_now.completed_at:%d %b %Y})"
                activity_service.record(
                    db,
                    workspace_id=workspace_id,
                    user_id=actor_id,
                    entity_type="stage_checklist_item",
                    entity_id=item.id,
                    action="completed",
                    summary=f'Marked "{item.title}" complete{version_suffix}{note_suffix}',
                )
            elif new_status == ChecklistItemStatus.NOT_REQUIRED:
                item.completed_at = datetime.now(timezone.utc)
                item.completed_by_user_id = actor_id
                activity_service.record(
                    db,
                    workspace_id=workspace_id,
                    user_id=actor_id,
                    entity_type="stage_checklist_item",
                    entity_id=item.id,
                    action="not_required",
                    summary=f'Marked "{item.title}" not required{note_suffix}',
                )
            elif new_status == ChecklistItemStatus.PENDING:
                if was_blocked:
                    activity_service.record(
                        db,
                        workspace_id=workspace_id,
                        user_id=actor_id,
                        entity_type="stage_checklist_item",
                        entity_id=item.id,
                        action="unblocked",
                        summary=f'Unblocked "{item.title}"{note_suffix}',
                    )
                elif was_complete_or_not_required:
                    item.completed_at = None
                    item.completed_by_user_id = None
                    activity_service.record(
                        db,
                        workspace_id=workspace_id,
                        user_id=actor_id,
                        entity_type="stage_checklist_item",
                        entity_id=item.id,
                        action="reopened",
                        summary=f'Reopened "{item.title}"{note_suffix}',
                    )
    elif data.blocked_reason is not None and item.status == ChecklistItemStatus.BLOCKED:
        item.blocked_reason = data.blocked_reason.strip()
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="stage_checklist_item",
            entity_id=item.id,
            action="blocked",
            summary=f'Updated blocked reason for "{item.title}" — {item.blocked_reason}',
        )
    elif note:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="stage_checklist_item",
            entity_id=item.id,
            action="noted",
            summary=f'Added a note to "{item.title}": {note}',
        )

    db.commit()
    return _get_checklist_for_item(db, workspace_id, item)


def remove_item(db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, item_id: uuid.UUID) -> StageChecklistRead | None:
    item = _get_item_in_workspace(db, workspace_id, item_id)
    if item is None:
        return None
    if item.is_default:
        raise HTTPException(status_code=400, detail="Default tasks can be marked Not required, but not removed.")

    owner_field, owner_id = _owner_field_and_id(item)
    title = item.title
    db.delete(item)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="stage_checklist_item",
        entity_id=item_id,
        action="removed",
        summary=f'Removed stage checklist task "{title}"',
    )
    db.commit()
    return _READERS[owner_field](db, workspace_id, owner_id)


def reorder_items(
    db: Session, workspace_id: uuid.UUID, owner_field: str, owner_id: uuid.UUID, data: ReorderStageChecklistItemsRequest
) -> StageChecklistRead | None:
    if _OWNER_LOOKUPS[owner_field](db, workspace_id, owner_id) is None:
        return None
    by_id = {i.id: i for i in db.scalars(select(StageChecklistItem).where(getattr(StageChecklistItem, owner_field) == owner_id))}
    for entry in data.items:
        item = by_id.get(entry.id)
        if item is not None:
            item.order_index = entry.order_index
    db.commit()
    return _READERS[owner_field](db, workspace_id, owner_id)
