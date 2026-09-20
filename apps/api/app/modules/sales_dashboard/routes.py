from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.sales_dashboard import service
from app.modules.sales_dashboard.schemas import SalesDashboard, WonDealsSeries
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/dashboard", tags=["sales_dashboard"])


@router.get("/sales", response_model=SalesDashboard)
def get_sales_dashboard(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> SalesDashboard:
    return service.get_sales_dashboard(db, current_user.workspace_id)


@router.get("/sales/won-deals", response_model=WonDealsSeries)
def get_won_deals_series(
    start: date,
    end: date,
    group_by: Literal["day", "week"] = "day",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WonDealsSeries:
    return service.get_won_deals_series(
        db, current_user.workspace_id, start_date=start, end_date=end, group_by=group_by
    )
