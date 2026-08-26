from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.action_engine import service
from app.modules.action_engine.schemas import DailyActionQueueRead
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/actions", tags=["action-engine"])


def _to_read(run) -> DailyActionQueueRead:
    return DailyActionQueueRead(
        run_id=run.id, workspace_id=run.workspace_id, generated_at=run.generated_at, items=run.items
    )


@router.get("/queue", response_model=DailyActionQueueRead)
def get_queue(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> DailyActionQueueRead:
    """Today's "Do This Next" queue — generated on first request of the
    day and reused for the rest of it (see get_or_generate_todays_queue)."""
    run = service.get_or_generate_todays_queue(db, current_user.workspace_id)
    return _to_read(run)


@router.post("/run", response_model=DailyActionQueueRead, status_code=201)
def run_action_engine(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DailyActionQueueRead:
    """Force a fresh recompute — what the "every morning" scheduled job
    calls, and what a manual "refresh" button in the UI would call too."""
    run = service.generate_queue(db, current_user.workspace_id)
    return _to_read(run)


@router.get("/history", response_model=list[DailyActionQueueRead])
def get_history(
    limit: int = 14, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DailyActionQueueRead]:
    runs = service.list_history(db, current_user.workspace_id, limit=limit)
    return [_to_read(run) for run in runs]
