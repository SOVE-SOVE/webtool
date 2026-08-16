import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.clients import service
from app.modules.clients.schemas import ClientCreate, ClientRead, ClientUpdate
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/clients", tags=["clients"])


@router.get("", response_model=list[ClientRead])
def list_clients(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[ClientRead]:
    return service.list_clients(db, current_user.workspace_id)


@router.post("", response_model=ClientRead, status_code=201)
def create_client(
    data: ClientCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ClientRead:
    return service.create_client(db, current_user.workspace_id, current_user.id, data)


@router.get("/{client_id}", response_model=ClientRead)
def get_client(
    client_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ClientRead:
    client = service.get_client(db, current_user.workspace_id, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.patch("/{client_id}", response_model=ClientRead)
def update_client(
    client_id: uuid.UUID,
    data: ClientUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ClientRead:
    client = service.update_client(db, current_user.workspace_id, current_user.id, client_id, data)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return client
