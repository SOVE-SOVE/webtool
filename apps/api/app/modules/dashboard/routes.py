from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.dashboard import service
from app.modules.dashboard.schemas import DashboardOverview
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("/overview", response_model=DashboardOverview)
def get_overview(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> DashboardOverview:
    return service.get_overview(db, current_user.workspace_id)
