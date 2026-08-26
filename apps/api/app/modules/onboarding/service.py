import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.activity_log import service as activity_service
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.onboarding.models import OnboardingCategory, OnboardingChecklistItem, OnboardingItemStatus
from app.modules.onboarding.schemas import (
    OnboardingCategoryProgress,
    OnboardingChecklistRead,
    OnboardingItemCreate,
    OnboardingItemRead,
    OnboardingItemUpdate,
)
from app.modules.projects.models import Project

# The starting checklist for a project's onboarding — one item per
# category, covering every area an onboarding needs to touch. Same
# "starting checklist, not a fixed workflow" contract as
# projects/service.py's DEFAULT_INTAKE_TASK_TITLES: any item here can be
# marked not_applicable when it doesn't fit a given project, and an
# operator adds/removes their own project-specific items on top.
DEFAULT_ONBOARDING_ITEMS: list[tuple[OnboardingCategory, str]] = [
    (OnboardingCategory.CLIENT_INFORMATION, "Collect business name and primary contact details"),
    (OnboardingCategory.PROJECT_TYPE, "Confirm the type of project (new build, redesign, migration, ...)"),
    (OnboardingCategory.GOALS, "Document the client's goals for the project"),
    (OnboardingCategory.TARGET_AUDIENCE, "Identify the target audience / customers"),
    (OnboardingCategory.SERVICES, "List the services or products to feature"),
    (OnboardingCategory.BRANDING, "Collect brand guidelines, colours, fonts, and logo"),
    (OnboardingCategory.EXISTING_ASSETS, "Gather existing images, copy, and documents"),
    (OnboardingCategory.DOMAIN, "Confirm the domain (new purchase or existing)"),
    (OnboardingCategory.HOSTING, "Confirm the hosting arrangement"),
    (OnboardingCategory.REQUIRED_PAGES, "Agree on the required pages"),
    (OnboardingCategory.FUNCTIONALITY, "Agree on required functionality (forms, booking, ecommerce, ...)"),
    (OnboardingCategory.CONTENT, "Collect page content (copy, testimonials, FAQs)"),
    (OnboardingCategory.DEADLINES, "Confirm the target deadline"),
    (OnboardingCategory.BUDGET, "Confirm the agreed budget / package"),
    (OnboardingCategory.APPROVALS, "Confirm who signs off approvals on the client side"),
]


def _get_project_in_workspace(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Project.id == project_id, Business.workspace_id == workspace_id)
    )


def _get_item_in_workspace(
    db: Session, workspace_id: uuid.UUID, item_id: uuid.UUID
) -> OnboardingChecklistItem | None:
    return db.scalar(
        select(OnboardingChecklistItem)
        .join(Project, OnboardingChecklistItem.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(OnboardingChecklistItem.id == item_id, Business.workspace_id == workspace_id)
    )


def seed_default_items(db: Session, project_id: uuid.UUID) -> None:
    """Seeds the starter checklist for a project. Not committed here —
    callers control the transaction, same convention as
    projects/service.py's create_default_tasks."""
    for index, (category, label) in enumerate(DEFAULT_ONBOARDING_ITEMS):
        db.add(
            OnboardingChecklistItem(project_id=project_id, category=category, label=label, sort_order=index)
        )


def _items_for_project(db: Session, project_id: uuid.UUID) -> list[OnboardingChecklistItem]:
    return list(
        db.scalars(
            select(OnboardingChecklistItem)
            .where(OnboardingChecklistItem.project_id == project_id)
            .order_by(OnboardingChecklistItem.sort_order, OnboardingChecklistItem.created_at)
        )
    )


def _progress_by_category(items: list[OnboardingChecklistItem]) -> list[OnboardingCategoryProgress]:
    progress: dict[OnboardingCategory, OnboardingCategoryProgress] = {
        category: OnboardingCategoryProgress(category=category, total=0, done=0, not_applicable=0, complete=True)
        for category in OnboardingCategory
    }
    for item in items:
        p = progress[item.category]
        p.total += 1
        if item.status == OnboardingItemStatus.DONE:
            p.done += 1
        elif item.status == OnboardingItemStatus.NOT_APPLICABLE:
            p.not_applicable += 1
    for p in progress.values():
        p.complete = p.total > 0 and (p.done + p.not_applicable) == p.total
    # Only surface categories that actually have items — a category with
    # every default deleted and no custom item added doesn't belong in a
    # progress list (in practice this only happens for a category whose
    # sole custom item was later removed, since defaults are never
    # deleted, only marked not-applicable).
    return [progress[category] for category in OnboardingCategory if progress[category].total > 0]


def _to_checklist_read(project_id: uuid.UUID, items: list[OnboardingChecklistItem]) -> OnboardingChecklistRead:
    done = sum(1 for i in items if i.status == OnboardingItemStatus.DONE)
    not_applicable = sum(1 for i in items if i.status == OnboardingItemStatus.NOT_APPLICABLE)
    applicable = len(items) - not_applicable
    percent = round(100 * done / applicable) if applicable else 100
    return OnboardingChecklistRead(
        project_id=project_id,
        items=[OnboardingItemRead.model_validate(i) for i in items],
        categories=_progress_by_category(items),
        total_items=len(items),
        done_items=done,
        not_applicable_items=not_applicable,
        percent_complete=percent,
    )


def get_checklist(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> OnboardingChecklistRead | None:
    project = _get_project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None
    items = _items_for_project(db, project.id)
    if not items:
        # Lazily seeded on first touch, same convention as design_briefs'
        # _get_or_create_draft — no separate "create checklist" step is
        # needed for a project that already existed before this feature.
        seed_default_items(db, project.id)
        db.commit()
        items = _items_for_project(db, project.id)
    return _to_checklist_read(project.id, items)


def add_item(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, project_id: uuid.UUID, data: OnboardingItemCreate
) -> OnboardingChecklistRead | None:
    project = _get_project_in_workspace(db, workspace_id, project_id)
    if project is None:
        return None

    existing = _items_for_project(db, project.id)
    if not existing:
        seed_default_items(db, project.id)
        db.flush()
        existing = _items_for_project(db, project.id)

    next_order = max((i.sort_order for i in existing), default=-1) + 1
    item = OnboardingChecklistItem(
        project_id=project.id,
        category=data.category,
        label=data.label,
        notes=data.notes,
        is_custom=True,
        sort_order=next_order,
    )
    db.add(item)
    db.flush()

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project.id,
        action="onboarding_item_added",
        summary=f"Added onboarding item: {item.label}",
    )

    db.commit()
    return _to_checklist_read(project.id, _items_for_project(db, project.id))


def update_item(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, item_id: uuid.UUID, data: OnboardingItemUpdate
) -> OnboardingChecklistRead | None:
    item = _get_item_in_workspace(db, workspace_id, item_id)
    if item is None:
        return None

    if data.status is not None and data.status != item.status:
        item.status = data.status
        activity_service.record(
            db,
            workspace_id=workspace_id,
            user_id=actor_id,
            entity_type="project",
            entity_id=item.project_id,
            action="onboarding_item_status_changed",
            summary=f"{item.label}: {data.status.value}",
        )

    if "notes" in data.model_fields_set:
        item.notes = data.notes

    db.commit()
    return _to_checklist_read(item.project_id, _items_for_project(db, item.project_id))


def delete_item(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, item_id: uuid.UUID
) -> OnboardingChecklistRead | None:
    """Only a custom item can be deleted outright — a seeded default is
    marked not_applicable instead (see the model docstring for why)."""
    item = _get_item_in_workspace(db, workspace_id, item_id)
    if item is None:
        return None
    if not item.is_custom:
        raise HTTPException(
            status_code=400, detail="Only a custom item can be deleted — mark it not_applicable instead"
        )

    project_id = item.project_id
    label = item.label
    db.delete(item)
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="project",
        entity_id=project_id,
        action="onboarding_item_removed",
        summary=f"Removed onboarding item: {label}",
    )
    db.commit()
    return _to_checklist_read(project_id, _items_for_project(db, project_id))
