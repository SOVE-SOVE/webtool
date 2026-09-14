import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.checklists import service
from app.modules.checklists.schemas import (
    AddChecklistItemRequest,
    ClientChecklistRead,
    ClientChecklistSummary,
    ReorderChecklistItemsRequest,
    UpdateChecklistItemRequest,
)
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/clients", tags=["checklists"])


@router.get("/checklist-summaries", response_model=list[ClientChecklistSummary])
def list_checklist_summaries(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ClientChecklistSummary]:
    return service.list_checklist_summaries(db, current_user.workspace_id)


@router.get("/{client_id}/checklist", response_model=ClientChecklistRead)
def get_client_checklist(
    client_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ClientChecklistRead:
    checklist = service.get_client_checklist(db, current_user.workspace_id, client_id)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return checklist


@router.post("/{client_id}/checklist/items", response_model=ClientChecklistRead, status_code=201)
def add_checklist_item(
    client_id: uuid.UUID,
    data: AddChecklistItemRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClientChecklistRead:
    checklist = service.add_item(db, current_user.workspace_id, current_user.id, client_id, data)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return checklist


@router.patch("/checklist/items/{item_id}", response_model=ClientChecklistRead)
def update_checklist_item(
    item_id: uuid.UUID,
    data: UpdateChecklistItemRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClientChecklistRead:
    checklist = service.update_item(db, current_user.workspace_id, current_user.id, item_id, data)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return checklist


@router.post("/{client_id}/checklist/items/reorder", response_model=ClientChecklistRead)
def reorder_checklist_items(
    client_id: uuid.UUID,
    data: ReorderChecklistItemsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClientChecklistRead:
    checklist = service.reorder_items(db, current_user.workspace_id, client_id, data)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return checklist


@router.delete("/checklist/items/{item_id}", response_model=ClientChecklistRead)
def remove_checklist_item(
    item_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ClientChecklistRead:
    checklist = service.remove_item(db, current_user.workspace_id, current_user.id, item_id)
    if checklist is None:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return checklist
