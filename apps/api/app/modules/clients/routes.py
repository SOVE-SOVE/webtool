import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import require_operator
from app.db.session import get_db
from app.modules.clients import service
from app.modules.clients.schemas import ClientCreate, ClientRead

router = APIRouter(prefix="/api/v1/clients", tags=["clients"], dependencies=[Depends(require_operator)])


@router.get("", response_model=list[ClientRead])
def list_clients(db: Session = Depends(get_db)) -> list[ClientRead]:
    return service.list_clients(db)


@router.post("", response_model=ClientRead, status_code=201)
def create_client(data: ClientCreate, db: Session = Depends(get_db)) -> ClientRead:
    return service.create_client(db, data)


@router.get("/{client_id}", response_model=ClientRead)
def get_client(client_id: uuid.UUID, db: Session = Depends(get_db)) -> ClientRead:
    client = service.get_client(db, client_id)
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return client
