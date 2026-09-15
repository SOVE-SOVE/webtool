import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.billing import service
from app.modules.billing.schemas import (
    ClientBillingSummary,
    HostingChargeDueDateUpdate,
    HostingChargeRead,
    HostingPlanCreate,
    HostingPlanEffectiveDate,
    HostingPlanFeeChange,
    HostingPlanRead,
    NextPaymentObligation,
    NextPaymentSummary,
    PaymentCreate,
    PaymentRead,
    PaymentRefund,
    PaymentVoid,
    ProjectPaymentSummary,
    RevenueHostingPlan,
    RevenueReport,
    TodayBillingSnapshot,
    WebsiteAgreementRead,
    WebsiteAgreementUpsert,
)
from app.modules.users.models import User

# Every mutation here uses plain get_current_user — any authenticated
# workspace member, matching clients/projects — not require_admin.
router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


@router.get("/projects/{project_id}/agreement", response_model=WebsiteAgreementRead | None)
def get_agreement(
    project_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> WebsiteAgreementRead | None:
    return service.get_agreement_for_project(db, workspace_id=current_user.workspace_id, project_id=project_id)


@router.put("/projects/{project_id}/agreement", response_model=WebsiteAgreementRead)
def upsert_agreement(
    project_id: uuid.UUID,
    data: WebsiteAgreementUpsert,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WebsiteAgreementRead:
    return service.upsert_agreement(
        db, workspace_id=current_user.workspace_id, project_id=project_id, actor_id=current_user.id, data=data
    )


@router.get("/hosting-plans", response_model=list[RevenueHostingPlan])
def list_all_hosting_plans(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[RevenueHostingPlan]:
    return service.list_all_hosting_plans(db, workspace_id=current_user.workspace_id)


@router.get("/projects/{project_id}/hosting-plans", response_model=list[HostingPlanRead])
def list_hosting_plans(
    project_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[HostingPlanRead]:
    return service.list_hosting_plans_for_project(db, workspace_id=current_user.workspace_id, project_id=project_id)


@router.post("/projects/{project_id}/hosting-plans", response_model=HostingPlanRead, status_code=201)
def create_hosting_plan(
    project_id: uuid.UUID,
    data: HostingPlanCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HostingPlanRead:
    return service.create_hosting_plan(
        db, workspace_id=current_user.workspace_id, project_id=project_id, actor_id=current_user.id, data=data
    )


@router.patch("/hosting-plans/{plan_id}/pause", response_model=HostingPlanRead)
def pause_hosting_plan(
    plan_id: uuid.UUID,
    data: HostingPlanEffectiveDate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HostingPlanRead:
    return service.pause_hosting_plan(
        db, workspace_id=current_user.workspace_id, plan_id=plan_id, actor_id=current_user.id, data=data
    )


@router.patch("/hosting-plans/{plan_id}/resume", response_model=HostingPlanRead)
def resume_hosting_plan(
    plan_id: uuid.UUID,
    data: HostingPlanEffectiveDate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HostingPlanRead:
    return service.resume_hosting_plan(
        db, workspace_id=current_user.workspace_id, plan_id=plan_id, actor_id=current_user.id, data=data
    )


@router.patch("/hosting-plans/{plan_id}/cancel", response_model=HostingPlanRead)
def cancel_hosting_plan(
    plan_id: uuid.UUID,
    data: HostingPlanEffectiveDate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HostingPlanRead:
    return service.cancel_hosting_plan(
        db, workspace_id=current_user.workspace_id, plan_id=plan_id, actor_id=current_user.id, data=data
    )


@router.get("/hosting-plans/{plan_id}/charges", response_model=list[HostingChargeRead])
def list_hosting_charges(
    plan_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[HostingChargeRead]:
    return service.list_charges_for_plan(db, workspace_id=current_user.workspace_id, plan_id=plan_id)


@router.patch("/hosting-charges/{charge_id}/due-date", response_model=HostingChargeRead)
def update_hosting_charge_due_date(
    charge_id: uuid.UUID,
    data: HostingChargeDueDateUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HostingChargeRead:
    return service.update_hosting_charge_due_date(
        db, workspace_id=current_user.workspace_id, charge_id=charge_id, actor_id=current_user.id, data=data
    )


@router.patch("/hosting-plans/{plan_id}/fee", response_model=HostingPlanRead)
def change_hosting_fee(
    plan_id: uuid.UUID,
    data: HostingPlanFeeChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HostingPlanRead:
    return service.change_hosting_fee(
        db, workspace_id=current_user.workspace_id, plan_id=plan_id, actor_id=current_user.id, data=data
    )


@router.post("/payments", response_model=PaymentRead, status_code=201)
def record_payment(
    data: PaymentCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PaymentRead:
    return service.record_payment(db, workspace_id=current_user.workspace_id, actor_id=current_user.id, data=data)


@router.patch("/payments/{payment_id}/void", response_model=PaymentRead)
def void_payment(
    payment_id: uuid.UUID,
    data: PaymentVoid,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaymentRead:
    return service.void_payment(
        db, workspace_id=current_user.workspace_id, payment_id=payment_id, actor_id=current_user.id, data=data
    )


@router.patch("/payments/{payment_id}/refund", response_model=PaymentRead)
def refund_payment(
    payment_id: uuid.UUID,
    data: PaymentRefund,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PaymentRead:
    return service.refund_payment(
        db, workspace_id=current_user.workspace_id, payment_id=payment_id, actor_id=current_user.id, data=data
    )


@router.get("/clients/{client_id}/summary", response_model=ClientBillingSummary)
def get_client_billing_summary(
    client_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ClientBillingSummary:
    return service.get_client_billing_summary(db, workspace_id=current_user.workspace_id, client_id=client_id)


@router.get("/clients/{client_id}/next-payment", response_model=NextPaymentSummary)
def get_next_payment_summary(
    client_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> NextPaymentSummary:
    return service.get_next_payment_summary(db, workspace_id=current_user.workspace_id, client_id=client_id)


@router.get("/projects/{project_id}/summary", response_model=ProjectPaymentSummary)
def get_project_payment_summary(
    project_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProjectPaymentSummary:
    return service.get_project_payment_summary(db, workspace_id=current_user.workspace_id, project_id=project_id)


@router.get("/reports/revenue", response_model=RevenueReport)
def get_revenue_report(
    start: date, end: date, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RevenueReport:
    return service.get_revenue_report(db, workspace_id=current_user.workspace_id, start_date=start, end_date=end)


@router.get("/reports/obligations", response_model=list[NextPaymentObligation])
def get_workspace_obligations(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[NextPaymentObligation]:
    return service.get_workspace_obligations(db, workspace_id=current_user.workspace_id)


@router.get("/reports/today", response_model=TodayBillingSnapshot)
def get_today_snapshot(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> TodayBillingSnapshot:
    return service.get_today_snapshot(db, workspace_id=current_user.workspace_id)
