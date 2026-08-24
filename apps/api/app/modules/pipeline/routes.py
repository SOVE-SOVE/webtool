import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.pipeline import service
from app.modules.pipeline.schemas import PipelineStageRead, PipelineStageUpdate
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/pipeline", tags=["pipeline"])


@router.get("/stages", response_model=list[PipelineStageRead])
def list_pipeline_stages(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[PipelineStageRead]:
    return service.list_stages(db, current_user.workspace_id)


@router.patch("/stages/{stage_id}", response_model=PipelineStageRead)
def update_pipeline_stage(
    stage_id: uuid.UUID,
    data: PipelineStageUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PipelineStageRead:
    stage = service.update_stage(db, current_user.workspace_id, stage_id, data)
    if stage is None:
        raise HTTPException(status_code=404, detail="Pipeline stage not found")
    return stage
