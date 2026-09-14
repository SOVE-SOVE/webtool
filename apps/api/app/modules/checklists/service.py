import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import exists, select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.checklists import shared, signals
from app.modules.checklists.models import (
    ChecklistAutoSignal,
    ChecklistCompletionMode,
    ChecklistItemStatus,
    ClientChecklistItem,
)
from app.modules.checklists.schemas import (
    AddChecklistItemRequest,
    ChecklistCompletedBy,
    ChecklistItemRead,
    ChecklistNextAction,
    ChecklistProgress,
    ChecklistProgressPart,
    ClientChecklistProjectSection,
    ClientChecklistRead,
    ClientChecklistSummary,
    ReorderChecklistItemsRequest,
    UpdateChecklistItemRequest,
)
from app.modules.clients.models import Client
from app.modules.projects.models import Project
from app.modules.users.service import require_user_in_workspace

# Titles + wiring for the 10 default tasks (docs/05_DECISIONS.md). Only
# "Confirm business and contact details" is client-level — everything
# else is scoped per-project since a client can have several. 7 of the
# 9 project-level defaults have a reliable authoritative signal; the
# other 2 (plus the client-level one) have no such signal and stay
# manual — see checklists/signals.py for what each auto_signal reads.
# Every default task is is_required=True; only operator-added custom
# tasks default to optional (docs/05_DECISIONS.md).
DEFAULT_CLIENT_LEVEL_TASKS: list[tuple[str, ChecklistCompletionMode, ChecklistAutoSignal | None]] = [
    ("Confirm business and contact details", ChecklistCompletionMode.MANUAL, None),
]

DEFAULT_PROJECT_LEVEL_TASKS: list[tuple[str, ChecklistCompletionMode, ChecklistAutoSignal | None]] = [
    ("Confirm website scope", ChecklistCompletionMode.AUTOMATIC, ChecklistAutoSignal.WEBSITE_SCOPE_CONFIRMED),
    ("Approve website direction", ChecklistCompletionMode.AUTOMATIC, ChecklistAutoSignal.DIRECTION_APPROVED),
    ("Collect logo and approved images", ChecklistCompletionMode.MANUAL, None),
    ("Approve website content", ChecklistCompletionMode.AUTOMATIC, ChecklistAutoSignal.CONTENT_APPROVED),
    ("Build first preview", ChecklistCompletionMode.AUTOMATIC, ChecklistAutoSignal.PREVIEW_BUILT),
    ("Review client feedback", ChecklistCompletionMode.MANUAL, None),
    ("Complete final QA", ChecklistCompletionMode.AUTOMATIC, ChecklistAutoSignal.QA_COMPLETE),
    ("Approve launch", ChecklistCompletionMode.AUTOMATIC, ChecklistAutoSignal.LAUNCH_APPROVED),
    ("Launch website", ChecklistCompletionMode.AUTOMATIC, ChecklistAutoSignal.WEBSITE_LAUNCHED),
]

# Human labels for a MANUAL+signal item's "needs_review" reason and for
# the "reviewed X as of <date>" note recorded on completion — mirrors
# stage_checklists/service.py's _SIGNAL_LABELS. None of today's Delivery
# MANUAL defaults carry a signal yet, but the mechanism is generalized so
# any future or custom one gets this for free.
_SIGNAL_LABELS = {
    ChecklistAutoSignal.WEBSITE_SCOPE_CONFIRMED: "The client brief",
    ChecklistAutoSignal.DIRECTION_APPROVED: "The creative direction",
    ChecklistAutoSignal.CONTENT_APPROVED: "The sitemap/content",
    ChecklistAutoSignal.PREVIEW_BUILT: "The generated website",
    ChecklistAutoSignal.QA_COMPLETE: "The QA report",
    ChecklistAutoSignal.LAUNCH_APPROVED: "The client review",
    ChecklistAutoSignal.WEBSITE_LAUNCHED: "The deployment",
}


def initialise_client_checklist(db: Session, client_id: uuid.UUID) -> None:
    """Idempotent — a repeated call (e.g. two overlapping requests) never
    duplicates the client-level default. Called from
    clients/service.py::create_client, inside its existing transaction."""
    already_seeded = db.scalar(
        select(exists().where(ClientChecklistItem.client_id == client_id, ClientChecklistItem.project_id.is_(None)))
    )
    if already_seeded:
        return
    for i, (title, mode, signal) in enumerate(DEFAULT_CLIENT_LEVEL_TASKS):
        db.add(
            ClientChecklistItem(
                client_id=client_id,
                project_id=None,
                title=title,
                order_index=i,
                is_default=True,
                is_required=True,
                completion_mode=mode,
                auto_signal=signal,
            )
        )
    # Flushed (not committed — the caller's transaction owns that) so a
    # second call in the same still-open transaction sees these rows
    # too, since this session runs with autoflush=False.
    db.flush()


def initialise_project_checklist(db: Session, client_id: uuid.UUID, project_id: uuid.UUID) -> None:
    """Idempotent per-project — seeding a second project for the same
    client never touches the first project's rows, and calling this
    twice for the same project never duplicates. Called from both
    clients/service.py::create_client (the lead-conversion branch) and
    projects/service.py::create_project ("Start another project")."""
    already_seeded = db.scalar(
        select(exists().where(ClientChecklistItem.project_id == project_id, ClientChecklistItem.is_default.is_(True)))
    )
    if already_seeded:
        return
    for i, (title, mode, signal) in enumerate(DEFAULT_PROJECT_LEVEL_TASKS):
        db.add(
            ClientChecklistItem(
                client_id=client_id,
                project_id=project_id,
                title=title,
                order_index=i,
                is_default=True,
                is_required=True,
                completion_mode=mode,
                auto_signal=signal,
            )
        )
    db.flush()


def _get_client_in_workspace(db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID) -> Client | None:
    return db.scalar(
        select(Client)
        .join(Business, Client.business_id == Business.id)
        .where(Client.id == client_id, Business.workspace_id == workspace_id)
        .options(joinedload(Client.projects))
    )


def _get_item_in_workspace(db: Session, workspace_id: uuid.UUID, item_id: uuid.UUID) -> ClientChecklistItem | None:
    return db.scalar(
        select(ClientChecklistItem)
        .join(Client, ClientChecklistItem.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(ClientChecklistItem.id == item_id, Business.workspace_id == workspace_id)
        .options(joinedload(ClientChecklistItem.assigned_user), joinedload(ClientChecklistItem.completed_by_user))
    )


def _to_read(item: ClientChecklistItem, live: signals.SignalResult | None) -> ChecklistItemRead:
    """
    `live` is the resolved signal for the item's auto_signal (required
    when completion_mode is AUTOMATIC; optional but used for the
    needs_review staleness check when a MANUAL item happens to carry a
    signal too). None whenever the item has no auto_signal at all.
    """
    completed_by_user = (
        ChecklistCompletedBy(type="user", name=item.completed_by_user.name) if item.completed_by_user else None
    )
    assigned_user_name = item.assigned_user.name if item.assigned_user else None
    base = dict(
        id=item.id,
        client_id=item.client_id,
        project_id=item.project_id,
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
        return ChecklistItemRead(
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
        effective_status = ChecklistItemStatus.COMPLETE if live.done else ChecklistItemStatus.PENDING
        return ChecklistItemRead(
            **base,
            status=effective_status.value,
            completed_at=live.completed_at if live.done else None,
            completed_by=live.completed_by if live.done else None,
            link=live.link,
            blocked_reason=None,
            needs_review_reason=None,
        )

    # MANUAL, not blocked/not_required — stored status is authoritative
    # except a read-time-only "needs_review" flip when it's COMPLETE and
    # its linked signal (if any) has moved on since.
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

    return ChecklistItemRead(
        **base,
        status=effective,
        completed_at=item.completed_at,
        completed_by=completed_by_user,
        link=live.link if live else None,
        blocked_reason=None,
        needs_review_reason=needs_review_reason,
    )


def _progress(items: list[ChecklistItemRead]) -> ChecklistProgress:
    split = shared.compute_progress_split([(i.status, i.is_required) for i in items])
    return ChecklistProgress(
        required=ChecklistProgressPart(completed=split.required.completed, total=split.required.total, pct=split.required.pct),
        optional=ChecklistProgressPart(completed=split.optional.completed, total=split.optional.total, pct=split.optional.pct),
    )


def _next_item(items: list[ChecklistItemRead]) -> ChecklistItemRead | None:
    ordered = sorted(items, key=lambda i: i.order_index)
    return next((i for i in ordered if i.status in ("pending", "needs_review")), None)


def _next_action(items: list[ChecklistItemRead]) -> ChecklistNextAction:
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
        return ChecklistNextAction(kind="task", item=by_id[result.item.id])
    if result.kind == "blocked" and result.items:
        return ChecklistNextAction(kind="blocked", items=[by_id[c.id] for c in result.items])
    return ChecklistNextAction(kind="done")


def get_client_checklist(db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID) -> ClientChecklistRead | None:
    client = _get_client_in_workspace(db, workspace_id, client_id)
    if client is None:
        return None

    # Lazy backfill for a client that predates this feature (or any
    # future path that creates a Client/Project without going through
    # the two seed hooks) — idempotent, so a client that's already
    # seeded is untouched. This is what "safely support existing
    # clients without creating duplicate checklists" actually means in
    # practice: never duplicate, but never leave a real client showing
    # a permanently empty checklist either.
    initialise_client_checklist(db, client_id)
    for project in client.projects:
        initialise_project_checklist(db, client_id, project.id)
    db.commit()

    rows = list(
        db.scalars(
            select(ClientChecklistItem)
            .where(ClientChecklistItem.client_id == client_id)
            .options(joinedload(ClientChecklistItem.completed_by_user), joinedload(ClientChecklistItem.assigned_user))
            .order_by(ClientChecklistItem.order_index)
        )
    )

    by_project: dict[uuid.UUID, list[ClientChecklistItem]] = {}
    client_rows: list[ClientChecklistItem] = []
    for row in rows:
        if row.project_id is None:
            client_rows.append(row)
        else:
            by_project.setdefault(row.project_id, []).append(row)

    def resolve_rows(project_id: uuid.UUID | None, project_rows: list[ClientChecklistItem]) -> list[ChecklistItemRead]:
        needed_signals = {
            r.auto_signal
            for r in project_rows
            if r.auto_signal is not None and r.status not in (ChecklistItemStatus.NOT_REQUIRED, ChecklistItemStatus.BLOCKED)
        }
        live_by_signal = signals.resolve_all(db, needed_signals, project_id) if project_id and needed_signals else {}
        return [_to_read(r, live_by_signal.get(r.auto_signal)) for r in project_rows]

    client_items = resolve_rows(None, client_rows)

    projects_by_id = {p.id: p for p in client.projects}
    project_sections: list[ClientChecklistProjectSection] = []
    for project_id, project_rows in by_project.items():
        project = projects_by_id.get(project_id)
        if project is None:
            continue
        item_reads = resolve_rows(project_id, project_rows)
        project_sections.append(
            ClientChecklistProjectSection(
                project_id=project_id,
                project_name=project.name,
                items=item_reads,
                progress=_progress(item_reads),
                next_item=_next_item(item_reads),
                next_action=_next_action(item_reads),
            )
        )
    project_sections.sort(key=lambda s: s.project_name)

    return ClientChecklistRead(
        client_id=client_id,
        client_items=client_items,
        client_progress=_progress(client_items),
        client_next_action=_next_action(client_items),
        projects=project_sections,
    )


def list_checklist_summaries(db: Session, workspace_id: uuid.UUID) -> list[ClientChecklistSummary]:
    """
    One summary per client, for the compact Clients-list bar — the
    client-level tasks plus its single most relevant project (the first
    not-yet-fully-complete one by creation order, else the most recent),
    counting REQUIRED tasks only (a compact glance metric shouldn't be
    diluted by optional improvements). Never blends two projects' counts
    into one number.
    """
    clients = db.scalars(
        select(Client)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(joinedload(Client.projects))
    ).unique()

    out: list[ClientChecklistSummary] = []
    for client in clients:
        checklist = get_client_checklist(db, workspace_id, client.id)
        if checklist is None:
            continue
        if not checklist.projects:
            progress = checklist.client_progress.required
        else:
            projects_by_id = {p.id: p for p in client.projects}
            ordered_projects = sorted(
                checklist.projects,
                key=lambda s: projects_by_id[s.project_id].created_at if s.project_id in projects_by_id else datetime.min,
            )
            primary = next((s for s in ordered_projects if s.progress.required.pct != 100), ordered_projects[-1])
            combined_completed = checklist.client_progress.required.completed + primary.progress.required.completed
            combined_total = checklist.client_progress.required.total + primary.progress.required.total
            progress = ChecklistProgressPart(
                completed=combined_completed,
                total=combined_total,
                pct=round(combined_completed / combined_total * 100) if combined_total > 0 else None,
            )
        out.append(ClientChecklistSummary(client_id=client.id, completed=progress.completed, total=progress.total, pct=progress.pct))
    return out


def add_item(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, client_id: uuid.UUID, data: AddChecklistItemRequest
) -> ClientChecklistRead | None:
    client = _get_client_in_workspace(db, workspace_id, client_id)
    if client is None:
        return None
    if data.project_id is not None and data.project_id not in {p.id for p in client.projects}:
        raise HTTPException(status_code=404, detail="Project not found for this client")
    if data.assigned_user_id is not None:
        require_user_in_workspace(db, workspace_id, data.assigned_user_id)

    siblings = db.scalars(
        select(ClientChecklistItem).where(
            ClientChecklistItem.client_id == client_id, ClientChecklistItem.project_id == data.project_id
        )
    ).all()
    next_order = (max((s.order_index for s in siblings), default=-1)) + 1

    item = ClientChecklistItem(
        client_id=client_id,
        project_id=data.project_id,
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
        entity_type="client_checklist_item",
        entity_id=item.id,
        action="created",
        summary=f"Added checklist task \"{data.title}\"",
    )
    db.commit()
    return get_client_checklist(db, workspace_id, client_id)


def update_item(
    db: Session,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    item_id: uuid.UUID,
    data: UpdateChecklistItemRequest,
) -> ClientChecklistRead | None:
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
            entity_type="client_checklist_item",
            entity_id=item.id,
            action="assigned",
            summary="Unassigned" if data.assigned_user_id is None else "Reassigned",
        )

    note = data.note.strip() if data.note else None
    note_suffix = f" — {note}" if note else ""

    if data.status is not None:
        new_status = ChecklistItemStatus(data.status)
        live = signals.resolve(db, item.auto_signal, item.project_id) if (item.auto_signal is not None and item.project_id) else None
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
                entity_type="client_checklist_item",
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
                if item.completion_mode == ChecklistCompletionMode.MANUAL and item.auto_signal is not None and item.project_id:
                    live_now = signals.resolve(db, item.auto_signal, item.project_id)
                    if live_now.completed_at:
                        label = _SIGNAL_LABELS.get(item.auto_signal, "the underlying evidence")
                        version_suffix = f" (reviewed {label.lower()} as of {live_now.completed_at:%d %b %Y})"
                activity_service.record(
                    db,
                    workspace_id=workspace_id,
                    user_id=actor_id,
                    entity_type="client_checklist_item",
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
                    entity_type="client_checklist_item",
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
                        entity_type="client_checklist_item",
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
                        entity_type="client_checklist_item",
                        entity_id=item.id,
                        action="reopened",
                        summary=f'Reopened "{item.title}"{note_suffix}',
                    )
    elif data.blocked_reason is not None and item.status == ChecklistItemStatus.BLOCKED:
        # Editing the reason text without a status transition.
        item.blocked_reason = data.blocked_reason.strip()
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="client_checklist_item",
            entity_id=item.id,
            action="blocked",
            summary=f'Updated blocked reason for "{item.title}" — {item.blocked_reason}',
        )
    elif note:
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="client_checklist_item",
            entity_id=item.id,
            action="noted",
            summary=f'Added a note to "{item.title}": {note}',
        )

    db.commit()
    return get_client_checklist(db, workspace_id, item.client_id)


def reorder_items(
    db: Session, workspace_id: uuid.UUID, client_id: uuid.UUID, data: ReorderChecklistItemsRequest
) -> ClientChecklistRead | None:
    client = _get_client_in_workspace(db, workspace_id, client_id)
    if client is None:
        return None
    by_id = {
        i.id: i
        for i in db.scalars(select(ClientChecklistItem).where(ClientChecklistItem.client_id == client_id))
    }
    for entry in data.items:
        item = by_id.get(entry.id)
        if item is not None:
            item.order_index = entry.order_index
    db.commit()
    return get_client_checklist(db, workspace_id, client_id)


def remove_item(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, item_id: uuid.UUID
) -> ClientChecklistRead | None:
    item = _get_item_in_workspace(db, workspace_id, item_id)
    if item is None:
        return None
    if item.is_default:
        raise HTTPException(status_code=400, detail="Default tasks can be marked Not required, but not removed.")

    client_id = item.client_id
    title = item.title
    db.delete(item)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="client_checklist_item",
        entity_id=item_id,
        action="removed",
        summary=f"Removed checklist task \"{title}\"",
    )
    db.commit()
    return get_client_checklist(db, workspace_id, client_id)
