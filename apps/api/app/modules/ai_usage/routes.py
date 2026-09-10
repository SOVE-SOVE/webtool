"""
Admin-only read access to the AI usage log (T6). No write route — rows
are only ever written by app/integrations/ai/router.py around a real AI
call. Deliberately not a dashboard: two small JSON endpoints that answer
"what did the AI cost / what's failing", for an operator or an admin
Settings panel.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.auth import require_admin
from app.db.session import get_db
from app.modules.ai_usage import service
from app.modules.ai_usage.schemas import AiUsageEventRead, AiUsageSummary
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/ai-usage", tags=["ai-usage"])


@router.get("/summary", response_model=AiUsageSummary)
def get_summary(
    since_days: int = Query(default=30, ge=1, le=365),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AiUsageSummary:
    return service.summary(db, since_days=since_days)


@router.get("/events", response_model=list[AiUsageEventRead])
def list_events(
    limit: int = Query(default=50, ge=1, le=200),
    task: str | None = None,
    provider: str | None = None,
    success: bool | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[AiUsageEventRead]:
    return service.list_events(db, limit=limit, task=task, provider=provider, success=success)
