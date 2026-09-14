import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.stage_checklists import service
from app.modules.stage_checklists.schemas import (
    AddStageChecklistItemRequest,
    ReorderStageChecklistItemsRequest,
    StageChecklistRead,
    UpdateStageChecklistItemRequest,
)
from app.modules.users.models import User

router = APIRouter(tags=["stage-checklists"])


def _require(checklist: StageChecklistRead | None, not_found_detail: str) -> StageChecklistRead:
    if checklist is None:
        raise HTTPException(status_code=404, detail=not_found_detail)
    return checklist


# --- Discovery review --------------------------------------------------------------


@router.get("/api/v1/discovered-businesses/{discovered_business_id}/checklist", response_model=StageChecklistRead)
def get_discovery_checklist(
    discovered_business_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.get_discovery_checklist(db, current_user.workspace_id, discovered_business_id), "Discovered business not found")


@router.post("/api/v1/discovered-businesses/{discovered_business_id}/checklist/items", response_model=StageChecklistRead, status_code=201)
def add_discovery_checklist_item(
    discovered_business_id: uuid.UUID,
    data: AddStageChecklistItemRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StageChecklistRead:
    return _require(
        service.add_item(db, current_user.workspace_id, current_user.id, "discovered_business_id", discovered_business_id, data),
        "Discovered business not found",
    )


@router.post("/api/v1/discovered-businesses/{discovered_business_id}/checklist/items/reorder", response_model=StageChecklistRead)
def reorder_discovery_checklist_items(
    discovered_business_id: uuid.UUID,
    data: ReorderStageChecklistItemsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StageChecklistRead:
    return _require(
        service.reorder_items(db, current_user.workspace_id, "discovered_business_id", discovered_business_id, data),
        "Discovered business not found",
    )


# --- Lead ----------------------------------------------------------------------


@router.get("/api/v1/leads/{lead_id}/checklist", response_model=StageChecklistRead)
def get_lead_checklist(lead_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> StageChecklistRead:
    return _require(service.get_lead_checklist(db, current_user.workspace_id, lead_id), "Lead not found")


@router.post("/api/v1/leads/{lead_id}/checklist/items", response_model=StageChecklistRead, status_code=201)
def add_lead_checklist_item(
    lead_id: uuid.UUID, data: AddStageChecklistItemRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.add_item(db, current_user.workspace_id, current_user.id, "lead_id", lead_id, data), "Lead not found")


@router.post("/api/v1/leads/{lead_id}/checklist/items/reorder", response_model=StageChecklistRead)
def reorder_lead_checklist_items(
    lead_id: uuid.UUID, data: ReorderStageChecklistItemsRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.reorder_items(db, current_user.workspace_id, "lead_id", lead_id, data), "Lead not found")


# --- Planning --------------------------------------------------------------------


@router.get("/api/v1/planning/{planning_id}/checklist", response_model=StageChecklistRead)
def get_planning_checklist(
    planning_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.get_planning_checklist(db, current_user.workspace_id, planning_id), "Planning item not found")


@router.post("/api/v1/planning/{planning_id}/checklist/items", response_model=StageChecklistRead, status_code=201)
def add_planning_checklist_item(
    planning_id: uuid.UUID, data: AddStageChecklistItemRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(
        service.add_item(db, current_user.workspace_id, current_user.id, "lead_planning_id", planning_id, data), "Planning item not found"
    )


@router.post("/api/v1/planning/{planning_id}/checklist/items/reorder", response_model=StageChecklistRead)
def reorder_planning_checklist_items(
    planning_id: uuid.UUID, data: ReorderStageChecklistItemsRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.reorder_items(db, current_user.workspace_id, "lead_planning_id", planning_id, data), "Planning item not found")


# --- Project ---------------------------------------------------------------------


@router.get("/api/v1/projects/{project_id}/checklist", response_model=StageChecklistRead)
def get_project_stage_checklist(
    project_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.get_project_stage_checklist(db, current_user.workspace_id, project_id), "Project not found")


@router.post("/api/v1/projects/{project_id}/checklist/items", response_model=StageChecklistRead, status_code=201)
def add_project_stage_checklist_item(
    project_id: uuid.UUID, data: AddStageChecklistItemRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.add_item(db, current_user.workspace_id, current_user.id, "project_id", project_id, data), "Project not found")


@router.post("/api/v1/projects/{project_id}/checklist/items/reorder", response_model=StageChecklistRead)
def reorder_project_stage_checklist_items(
    project_id: uuid.UUID, data: ReorderStageChecklistItemsRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.reorder_items(db, current_user.workspace_id, "project_id", project_id, data), "Project not found")


# --- Generic item mutations (ownership inferred from the row itself) -------------


@router.patch("/api/v1/stage-checklist-items/{item_id}", response_model=StageChecklistRead)
def update_stage_checklist_item(
    item_id: uuid.UUID, data: UpdateStageChecklistItemRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.update_item(db, current_user.workspace_id, current_user.id, item_id, data), "Checklist item not found")


@router.delete("/api/v1/stage-checklist-items/{item_id}", response_model=StageChecklistRead)
def remove_stage_checklist_item(
    item_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> StageChecklistRead:
    return _require(service.remove_item(db, current_user.workspace_id, current_user.id, item_id), "Checklist item not found")
