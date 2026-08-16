from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import require_operator
from app.db.session import get_db
from app.modules.dashboard import service
from app.modules.dashboard.schemas import DashboardOverview

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"], dependencies=[Depends(require_operator)])


@router.get("/overview", response_model=DashboardOverview)
def get_overview(db: Session = Depends(get_db)) -> DashboardOverview:
    return service.get_overview(db)
