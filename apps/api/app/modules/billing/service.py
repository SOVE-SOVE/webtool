import calendar
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.activity_log import service as activity_service
from app.modules.billing.models import HostingCharge, HostingPlan, HostingPlanStatus, Payment, WebsiteAgreement
from app.modules.billing.schemas import (
    BalanceRow,
    ClientBillingProject,
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
    RevenueTransaction,
    TodayBillingSnapshot,
    WebsiteAgreementRead,
    WebsiteAgreementUpsert,
)
from app.modules.clients.models import Client
from app.modules.projects.models import Project
from app.modules.workspaces.models import Workspace

# A rapid identical resubmission (double-click, retried request) within
# this window returns the existing row instead of creating a duplicate
# — the codebase's established check-before-create idiom, not a new
# idempotency-key mechanism.
_DUPLICATE_GUARD_SECONDS = 5


# ---------------------------------------------------------------------------
# Date / month-math helpers (billing-day clamping for 29th-31st in shorter
# months — the first such helper in this codebase; stdlib only, no new
# dependency, per the confirmed "no relativedelta anywhere" convention).
# ---------------------------------------------------------------------------


def _clamp_day(year: int, month: int, day: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last_day))


def first_occurrence_on_or_after(start_date: date, billing_day: int) -> date:
    candidate = _clamp_day(start_date.year, start_date.month, billing_day)
    if candidate >= start_date:
        return candidate
    year, month = start_date.year, start_date.month + 1
    if month > 12:
        month, year = 1, year + 1
    return _clamp_day(year, month, billing_day)


def advance_one_month(d: date, billing_day: int) -> date:
    year, month = d.year, d.month + 1
    if month > 12:
        month, year = 1, year + 1
    return _clamp_day(year, month, billing_day)


def today_in_workspace(db: Session, workspace_id: uuid.UUID) -> date:
    workspace = db.get(Workspace, workspace_id)
    tz_name = workspace.timezone if workspace else "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")
    return datetime.now(tz).date()


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _net_cents(payment: Payment) -> int:
    if payment.voided_at is not None:
        return 0
    return payment.amount_cents - payment.refunded_cents


def _payment_to_read(payment: Payment) -> PaymentRead:
    return PaymentRead(
        id=payment.id,
        project_id=payment.project_id,
        client_id=payment.client_id,
        website_agreement_id=payment.website_agreement_id,
        hosting_charge_id=payment.hosting_charge_id,
        amount_cents=payment.amount_cents,
        received_date=payment.received_date,
        method=payment.method,
        reference=payment.reference,
        notes=payment.notes,
        refunded_cents=payment.refunded_cents,
        voided_at=payment.voided_at,
        voided_reason=payment.voided_reason,
        net_cents=_net_cents(payment),
        created_at=payment.created_at,
    )


def _require_project(db: Session, workspace_id: uuid.UUID, project_id: uuid.UUID) -> Project:
    project = db.scalar(
        select(Project).where(Project.id == project_id, Project.workspace_id == workspace_id)
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _require_hosting_plan(db: Session, workspace_id: uuid.UUID, plan_id: uuid.UUID) -> HostingPlan:
    plan = db.scalar(
        select(HostingPlan).where(HostingPlan.id == plan_id, HostingPlan.workspace_id == workspace_id)
    )
    if plan is None:
        raise HTTPException(status_code=404, detail="Hosting plan not found")
    return plan


def _require_payment(db: Session, workspace_id: uuid.UUID, payment_id: uuid.UUID) -> Payment:
    payment = db.scalar(
        select(Payment).where(Payment.id == payment_id, Payment.workspace_id == workspace_id)
    )
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


# ---------------------------------------------------------------------------
# Website agreements
# ---------------------------------------------------------------------------


def get_agreement_for_project(
    db: Session, *, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> WebsiteAgreement | None:
    return db.scalar(
        select(WebsiteAgreement).where(
            WebsiteAgreement.workspace_id == workspace_id, WebsiteAgreement.project_id == project_id
        )
    )


def _format_agreement_summary(data: WebsiteAgreementUpsert) -> str:
    if data.price_cents is None:
        return "Website agreement price cleared (unconfigured)"
    parts = [f"Website price set to {_money(data.price_cents)}"]
    if data.deposit_required_cents:
        parts.append(f"deposit {_money(data.deposit_required_cents)}")
    if data.due_date:
        parts.append(f"due {data.due_date.isoformat()}")
    return ", ".join(parts)


def upsert_agreement(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    actor_id: uuid.UUID,
    data: WebsiteAgreementUpsert,
) -> WebsiteAgreement:
    project = _require_project(db, workspace_id, project_id)
    agreement = get_agreement_for_project(db, workspace_id=workspace_id, project_id=project_id)
    is_new = agreement is None
    if agreement is None:
        agreement = WebsiteAgreement(project_id=project_id, workspace_id=workspace_id)
        db.add(agreement)

    agreement.price_cents = data.price_cents
    agreement.deposit_required_cents = data.deposit_required_cents
    agreement.due_date = data.due_date
    agreement.notes = data.notes

    # Mirror onto the legacy Project.price_cents field so existing
    # pages/API consumers that already read it stay in sync — the
    # agreement is the new source of truth, price_cents is a synced
    # denormalized mirror, not removed or deprecated.
    project.price_cents = data.price_cents

    db.flush()
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="website_agreement",
        entity_id=agreement.id,
        action="agreement_set" if is_new else "agreement_updated",
        summary=_format_agreement_summary(data),
    )
    db.commit()
    db.refresh(agreement)
    return agreement


# ---------------------------------------------------------------------------
# Hosting plans
# ---------------------------------------------------------------------------


def list_hosting_plans_for_project(
    db: Session, *, workspace_id: uuid.UUID, project_id: uuid.UUID
) -> list[HostingPlan]:
    _require_project(db, workspace_id, project_id)
    return list(
        db.scalars(
            select(HostingPlan)
            .where(HostingPlan.workspace_id == workspace_id, HostingPlan.project_id == project_id)
            .order_by(HostingPlan.created_at.desc())
        )
    )


def create_hosting_plan(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    project_id: uuid.UUID,
    actor_id: uuid.UUID,
    data: HostingPlanCreate,
) -> HostingPlan:
    _require_project(db, workspace_id, project_id)
    # No charge is generated here — the sweep job picks the plan up once
    # next_due_date arrives (same day, if start_date is today).
    next_due = first_occurrence_on_or_after(data.start_date, data.billing_day)
    plan = HostingPlan(
        project_id=project_id,
        workspace_id=workspace_id,
        status=HostingPlanStatus.ACTIVE,
        monthly_fee_cents=data.monthly_fee_cents,
        start_date=data.start_date,
        billing_day=data.billing_day,
        next_due_date=next_due,
    )
    db.add(plan)
    db.flush()
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="hosting_plan",
        entity_id=plan.id,
        action="hosting_plan_created",
        summary=f"Hosting plan created — {_money(data.monthly_fee_cents)}/mo, billing day {data.billing_day}",
    )
    db.commit()
    db.refresh(plan)
    return plan


def pause_hosting_plan(
    db: Session, *, workspace_id: uuid.UUID, plan_id: uuid.UUID, actor_id: uuid.UUID, data: HostingPlanEffectiveDate
) -> HostingPlan:
    plan = _require_hosting_plan(db, workspace_id, plan_id)
    if plan.status != HostingPlanStatus.ACTIVE:
        raise HTTPException(status_code=409, detail="Only an active hosting plan can be paused")
    plan.status = HostingPlanStatus.PAUSED
    plan.paused_at = datetime.now(timezone.utc)
    plan.paused_effective_date = data.effective_date
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="hosting_plan",
        entity_id=plan.id,
        action="hosting_plan_paused",
        summary=f"Hosting plan paused, effective {data.effective_date.isoformat()}"
        + (f" — {data.reason}" if data.reason else ""),
    )
    db.commit()
    db.refresh(plan)
    return plan


def resume_hosting_plan(
    db: Session, *, workspace_id: uuid.UUID, plan_id: uuid.UUID, actor_id: uuid.UUID, data: HostingPlanEffectiveDate
) -> HostingPlan:
    plan = _require_hosting_plan(db, workspace_id, plan_id)
    if plan.status != HostingPlanStatus.PAUSED:
        raise HTTPException(status_code=409, detail="Only a paused hosting plan can be resumed")
    plan.status = HostingPlanStatus.ACTIVE
    # Never generate a backlog of charges for the paused period — pick up
    # from whichever is later: where it already was, or the resume date.
    plan.next_due_date = max(plan.next_due_date, data.effective_date)
    plan.paused_at = None
    plan.paused_effective_date = None
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="hosting_plan",
        entity_id=plan.id,
        action="hosting_plan_resumed",
        summary=f"Hosting plan resumed, effective {data.effective_date.isoformat()}",
    )
    db.commit()
    db.refresh(plan)
    return plan


def cancel_hosting_plan(
    db: Session, *, workspace_id: uuid.UUID, plan_id: uuid.UUID, actor_id: uuid.UUID, data: HostingPlanEffectiveDate
) -> HostingPlan:
    plan = _require_hosting_plan(db, workspace_id, plan_id)
    if plan.status == HostingPlanStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="Hosting plan is already cancelled")
    plan.status = HostingPlanStatus.CANCELLED
    plan.cancelled_at = datetime.now(timezone.utc)
    plan.cancelled_effective_date = data.effective_date
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="hosting_plan",
        entity_id=plan.id,
        action="hosting_plan_cancelled",
        summary=f"Hosting plan cancelled, effective {data.effective_date.isoformat()}"
        + (f" — {data.reason}" if data.reason else ""),
    )
    db.commit()
    db.refresh(plan)
    return plan


def change_hosting_fee(
    db: Session, *, workspace_id: uuid.UUID, plan_id: uuid.UUID, actor_id: uuid.UUID, data: HostingPlanFeeChange
) -> HostingPlan:
    plan = _require_hosting_plan(db, workspace_id, plan_id)
    old_fee = plan.monthly_fee_cents
    plan.monthly_fee_cents = data.new_monthly_fee_cents
    plan.fee_changed_at = datetime.now(timezone.utc)
    # Past HostingCharge rows keep their own amount_cents snapshot — this
    # never rewrites history, only what future sweep-generated charges use.
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="hosting_plan",
        entity_id=plan.id,
        action="hosting_fee_changed",
        summary=(
            f"Hosting fee changed from {_money(old_fee)} to {_money(data.new_monthly_fee_cents)}, "
            f"effective {data.effective_date.isoformat()}"
        ),
    )
    db.commit()
    db.refresh(plan)
    return plan


# ---------------------------------------------------------------------------
# Hosting-charge sweep support (called from app/jobs/handlers.py)
# ---------------------------------------------------------------------------


def list_active_plans_due(db: Session, *, workspace_id: uuid.UUID, as_of: date) -> list[HostingPlan]:
    return list(
        db.scalars(
            select(HostingPlan).where(
                HostingPlan.workspace_id == workspace_id,
                HostingPlan.status == HostingPlanStatus.ACTIVE,
                HostingPlan.next_due_date <= as_of,
            )
        )
    )


def list_charges_for_plan(db: Session, *, workspace_id: uuid.UUID, plan_id: uuid.UUID) -> list[HostingChargeRead]:
    _require_hosting_plan(db, workspace_id, plan_id)
    today = today_in_workspace(db, workspace_id)
    charges = db.scalars(
        select(HostingCharge)
        .where(HostingCharge.hosting_plan_id == plan_id)
        .options(joinedload(HostingCharge.payments))
        .order_by(HostingCharge.billing_period.desc())
    ).unique()
    rows: list[HostingChargeRead] = []
    for charge in charges:
        paid = sum(_net_cents(p) for p in charge.payments)
        outstanding = max(0, charge.amount_cents - paid)
        rows.append(
            HostingChargeRead(
                id=charge.id,
                hosting_plan_id=charge.hosting_plan_id,
                billing_period=charge.billing_period,
                due_date=charge.due_date,
                amount_cents=charge.amount_cents,
                paid_cents=paid,
                outstanding_cents=outstanding,
                is_overdue=charge.due_date < today and outstanding > 0,
            )
        )
    return rows


def _require_hosting_charge(db: Session, workspace_id: uuid.UUID, charge_id: uuid.UUID) -> HostingCharge:
    charge = db.scalar(
        select(HostingCharge).where(HostingCharge.id == charge_id, HostingCharge.workspace_id == workspace_id)
    )
    if charge is None:
        raise HTTPException(status_code=404, detail="Hosting charge not found")
    return charge


def update_hosting_charge_due_date(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    charge_id: uuid.UUID,
    actor_id: uuid.UUID,
    data: HostingChargeDueDateUpdate,
) -> HostingChargeRead:
    """
    The one due-date editor the existing Billing UI was missing: a
    generated HostingCharge's due_date is otherwise fixed at whatever
    the sweep job clamped it to from the plan's billing_day. Doesn't
    touch billing_period (the charge still belongs to the same billing
    month) or the plan's own next_due_date/billing_day, so future
    charges keep being generated on the plan's normal schedule.
    """
    charge = _require_hosting_charge(db, workspace_id, charge_id)
    old_due_date = charge.due_date
    charge.due_date = data.due_date
    db.flush()
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="hosting_charge",
        entity_id=charge.id,
        action="due_date_changed",
        summary=f"Hosting charge due date changed from {old_due_date.isoformat()} to {data.due_date.isoformat()}",
    )
    db.commit()
    db.refresh(charge)

    paid = sum(_net_cents(p) for p in charge.payments)
    outstanding = max(0, charge.amount_cents - paid)
    today = today_in_workspace(db, workspace_id)
    return HostingChargeRead(
        id=charge.id,
        hosting_plan_id=charge.hosting_plan_id,
        billing_period=charge.billing_period,
        due_date=charge.due_date,
        amount_cents=charge.amount_cents,
        paid_cents=paid,
        outstanding_cents=outstanding,
        is_overdue=charge.due_date < today and outstanding > 0,
    )


def generate_charge_if_missing(db: Session, *, plan: HostingPlan) -> HostingCharge:
    """
    Idempotent charge creation for one billing period of one plan.
    Primary guard: check-before-create (this query). The DB
    UniqueConstraint on (hosting_plan_id, billing_period) is a backstop
    only — this codebase has no IntegrityError-catching precedent, so
    the sweep must never rely on hitting it in normal operation.
    """
    billing_period = date(plan.next_due_date.year, plan.next_due_date.month, 1)
    existing = db.scalar(
        select(HostingCharge).where(
            HostingCharge.hosting_plan_id == plan.id, HostingCharge.billing_period == billing_period
        )
    )
    if existing is not None:
        return existing
    charge = HostingCharge(
        hosting_plan_id=plan.id,
        workspace_id=plan.workspace_id,
        billing_period=billing_period,
        due_date=plan.next_due_date,
        amount_cents=plan.monthly_fee_cents,
    )
    db.add(charge)
    db.flush()
    return charge


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


def record_payment(db: Session, *, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: PaymentCreate) -> PaymentRead:
    project = _require_project(db, workspace_id, data.project_id)

    agreement_id: uuid.UUID | None = None
    hosting_charge_id: uuid.UUID | None = None
    if data.allocation.type == "agreement":
        agreement = db.scalar(
            select(WebsiteAgreement).where(
                WebsiteAgreement.id == data.allocation.id,
                WebsiteAgreement.workspace_id == workspace_id,
                WebsiteAgreement.project_id == data.project_id,
            )
        )
        if agreement is None:
            raise HTTPException(status_code=404, detail="Website agreement not found")
        agreement_id = agreement.id
    else:
        charge = db.scalar(
            select(HostingCharge)
            .join(HostingPlan, HostingCharge.hosting_plan_id == HostingPlan.id)
            .where(
                HostingCharge.id == data.allocation.id,
                HostingCharge.workspace_id == workspace_id,
                HostingPlan.project_id == data.project_id,
            )
        )
        if charge is None:
            raise HTTPException(status_code=404, detail="Hosting charge not found")
        hosting_charge_id = charge.id

    recent_cutoff = datetime.now(timezone.utc) - timedelta(seconds=_DUPLICATE_GUARD_SECONDS)
    duplicate = db.scalar(
        select(Payment).where(
            Payment.workspace_id == workspace_id,
            Payment.project_id == data.project_id,
            Payment.website_agreement_id == agreement_id,
            Payment.hosting_charge_id == hosting_charge_id,
            Payment.amount_cents == data.amount_cents,
            Payment.received_date == data.received_date,
            Payment.created_at >= recent_cutoff,
        )
    )
    if duplicate is not None:
        return _payment_to_read(duplicate)

    payment = Payment(
        workspace_id=workspace_id,
        client_id=project.client_id,
        project_id=project.id,
        website_agreement_id=agreement_id,
        hosting_charge_id=hosting_charge_id,
        amount_cents=data.amount_cents,
        received_date=data.received_date,
        method=data.method,
        reference=data.reference,
        notes=data.notes,
        recorded_by_user_id=actor_id,
    )
    db.add(payment)
    db.flush()

    kind = "website purchase" if agreement_id else "hosting"
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="payment",
        entity_id=payment.id,
        action="payment_recorded",
        summary=f"Recorded {_money(data.amount_cents)} payment for {project.name} ({kind})",
    )
    db.commit()
    db.refresh(payment)
    return _payment_to_read(payment)


def void_payment(
    db: Session, *, workspace_id: uuid.UUID, payment_id: uuid.UUID, actor_id: uuid.UUID, data: PaymentVoid
) -> PaymentRead:
    payment = _require_payment(db, workspace_id, payment_id)
    if payment.voided_at is not None:
        raise HTTPException(status_code=409, detail="Payment is already voided")
    payment.voided_at = datetime.now(timezone.utc)
    payment.voided_reason = data.reason
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="payment",
        entity_id=payment.id,
        action="payment_voided",
        summary=f"Voided payment — {data.reason}",
    )
    db.commit()
    db.refresh(payment)
    return _payment_to_read(payment)


def refund_payment(
    db: Session, *, workspace_id: uuid.UUID, payment_id: uuid.UUID, actor_id: uuid.UUID, data: PaymentRefund
) -> PaymentRead:
    payment = _require_payment(db, workspace_id, payment_id)
    if payment.voided_at is not None:
        raise HTTPException(status_code=409, detail="Cannot refund a voided payment")
    if data.refund_amount_cents <= 0:
        raise HTTPException(status_code=422, detail="refund_amount_cents must be positive")
    new_refunded = payment.refunded_cents + data.refund_amount_cents
    if new_refunded > payment.amount_cents:
        raise HTTPException(status_code=422, detail="Refund exceeds the payment's remaining amount")
    payment.refunded_cents = new_refunded
    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="payment",
        entity_id=payment.id,
        action="payment_refunded",
        summary=f"Refunded {_money(data.refund_amount_cents)} — {data.reason}",
    )
    db.commit()
    db.refresh(payment)
    return _payment_to_read(payment)


# ---------------------------------------------------------------------------
# Reporting — defined once here, reused identically by Revenue, Client
# Billing, Project Payment summary, and Today (never recomputed per-page).
# ---------------------------------------------------------------------------


def get_payments_received(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    start_date: date,
    end_date: date,
    client_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> int:
    return sum(
        _net_cents(p)
        for p in _payments_in_range(
            db, workspace_id=workspace_id, start_date=start_date, end_date=end_date,
            client_id=client_id, project_id=project_id,
        )
        if p.voided_at is None
    )


def _payments_in_range(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    start_date: date,
    end_date: date,
    client_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> list[Payment]:
    query = select(Payment).where(
        Payment.workspace_id == workspace_id,
        Payment.received_date >= start_date,
        Payment.received_date <= end_date,
    )
    if client_id is not None:
        query = query.where(Payment.client_id == client_id)
    if project_id is not None:
        query = query.where(Payment.project_id == project_id)
    return list(db.scalars(query.order_by(Payment.received_date.desc())))


def get_mrr(db: Session, *, workspace_id: uuid.UUID) -> int:
    plans = db.scalars(
        select(HostingPlan).where(
            HostingPlan.workspace_id == workspace_id, HostingPlan.status == HostingPlanStatus.ACTIVE
        )
    )
    return sum(p.monthly_fee_cents for p in plans)


def _balance_rows(
    db: Session,
    workspace_id: uuid.UUID,
    today: date,
    client_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> list[BalanceRow]:
    project_ids: set[uuid.UUID] | None = None
    if client_id is not None:
        project_ids = {
            p.id
            for p in db.scalars(
                select(Project).where(Project.workspace_id == workspace_id, Project.client_id == client_id)
            )
        }

    rows: list[BalanceRow] = []

    agreement_query = (
        select(WebsiteAgreement)
        .where(WebsiteAgreement.workspace_id == workspace_id)
        .options(joinedload(WebsiteAgreement.project), joinedload(WebsiteAgreement.payments))
    )
    if project_id is not None:
        agreement_query = agreement_query.where(WebsiteAgreement.project_id == project_id)
    for agreement in db.scalars(agreement_query).unique():
        if project_ids is not None and agreement.project_id not in project_ids:
            continue
        if agreement.price_cents is None:
            continue
        paid = sum(_net_cents(p) for p in agreement.payments)
        outstanding = max(0, agreement.price_cents - paid)
        is_overdue = agreement.due_date is not None and agreement.due_date < today and outstanding > 0
        rows.append(
            BalanceRow(
                kind="agreement",
                id=agreement.id,
                project_id=agreement.project_id,
                client_id=agreement.project.client_id,
                label=f"{agreement.project.name} — website",
                total_cents=agreement.price_cents,
                paid_cents=paid,
                outstanding_cents=outstanding,
                due_date=agreement.due_date,
                is_overdue=is_overdue,
            )
        )

    charge_query = (
        select(HostingCharge)
        .join(HostingPlan, HostingCharge.hosting_plan_id == HostingPlan.id)
        .where(HostingCharge.workspace_id == workspace_id)
        .options(joinedload(HostingCharge.hosting_plan).joinedload(HostingPlan.project), joinedload(HostingCharge.payments))
    )
    if project_id is not None:
        charge_query = charge_query.where(HostingPlan.project_id == project_id)
    for charge in db.scalars(charge_query).unique():
        plan = charge.hosting_plan
        if project_ids is not None and plan.project_id not in project_ids:
            continue
        paid = sum(_net_cents(p) for p in charge.payments)
        outstanding = max(0, charge.amount_cents - paid)
        is_overdue = charge.due_date < today and outstanding > 0
        rows.append(
            BalanceRow(
                kind="hosting_charge",
                id=charge.id,
                project_id=plan.project_id,
                client_id=plan.project.client_id,
                label=f"{plan.project.name} — hosting ({charge.billing_period:%b %Y})",
                total_cents=charge.amount_cents,
                paid_cents=paid,
                outstanding_cents=outstanding,
                due_date=charge.due_date,
                is_overdue=is_overdue,
            )
        )

    return rows


def get_outstanding_balances(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    client_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> list[BalanceRow]:
    today = today_in_workspace(db, workspace_id)
    return [r for r in _balance_rows(db, workspace_id, today, client_id, project_id) if r.outstanding_cents > 0]


def get_overdue_charges(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    client_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> list[BalanceRow]:
    today = today_in_workspace(db, workspace_id)
    return [r for r in _balance_rows(db, workspace_id, today, client_id, project_id) if r.is_overdue]


def get_client_billing_summary(db: Session, *, workspace_id: uuid.UUID, client_id: uuid.UUID) -> ClientBillingSummary:
    projects = list(
        db.scalars(select(Project).where(Project.workspace_id == workspace_id, Project.client_id == client_id))
    )
    project_summaries: list[ClientBillingProject] = []
    all_payments: list[Payment] = []
    for project in projects:
        agreement = get_agreement_for_project(db, workspace_id=workspace_id, project_id=project.id)
        agreement_paid = 0
        agreement_outstanding = 0
        if agreement is not None and agreement.price_cents is not None:
            agreement_paid = sum(_net_cents(p) for p in agreement.payments)
            agreement_outstanding = max(0, agreement.price_cents - agreement_paid)
        plans = list(db.scalars(select(HostingPlan).where(HostingPlan.project_id == project.id)))
        project_summaries.append(
            ClientBillingProject(
                project_id=project.id,
                project_name=project.name,
                agreement=WebsiteAgreementRead.model_validate(agreement) if agreement else None,
                agreement_paid_cents=agreement_paid,
                agreement_outstanding_cents=agreement_outstanding,
                hosting_plans=[HostingPlanRead.model_validate(p) for p in plans],
            )
        )
        all_payments.extend(
            db.scalars(select(Payment).where(Payment.project_id == project.id).order_by(Payment.received_date.desc()))
        )

    all_payments.sort(key=lambda p: p.received_date, reverse=True)
    return ClientBillingSummary(
        client_id=client_id,
        projects=project_summaries,
        payments=[_payment_to_read(p) for p in all_payments],
    )


def get_project_payment_summary(db: Session, *, workspace_id: uuid.UUID, project_id: uuid.UUID) -> ProjectPaymentSummary:
    project = _require_project(db, workspace_id, project_id)
    agreement = get_agreement_for_project(db, workspace_id=workspace_id, project_id=project_id)
    paid = 0
    outstanding = 0
    status: str = "unconfigured"
    if agreement is not None and agreement.price_cents is not None:
        paid = sum(_net_cents(p) for p in agreement.payments)
        outstanding = max(0, agreement.price_cents - paid)
        if paid > agreement.price_cents:
            status = "overpaid"
        elif outstanding == 0:
            status = "paid"
        elif paid > 0:
            status = "partially_paid"
        else:
            status = "unpaid"

    plans = list(db.scalars(select(HostingPlan).where(HostingPlan.project_id == project_id)))
    payments = list(
        db.scalars(select(Payment).where(Payment.project_id == project_id).order_by(Payment.received_date.desc()))
    )
    return ProjectPaymentSummary(
        project_id=project_id,
        client_id=project.client_id,
        agreement=WebsiteAgreementRead.model_validate(agreement) if agreement else None,
        price_cents=agreement.price_cents if agreement else None,
        paid_cents=paid,
        outstanding_cents=outstanding,
        status=status,
        hosting_plans=[HostingPlanRead.model_validate(p) for p in plans],
        payments=[_payment_to_read(p) for p in payments],
    )


def get_revenue_report(db: Session, *, workspace_id: uuid.UUID, start_date: date, end_date: date) -> RevenueReport:
    all_payments = _payments_in_range(db, workspace_id=workspace_id, start_date=start_date, end_date=end_date)
    # Totals are computed only from non-voided payments (net of refunds,
    # via _net_cents) — but the transaction list below includes voided
    # ones too, so the Payments tab can show reversals rather than have
    # them silently vanish from the period's history.
    active_payments = [p for p in all_payments if p.voided_at is None]
    website_cents = sum(_net_cents(p) for p in active_payments if p.website_agreement_id is not None)
    hosting_cents = sum(_net_cents(p) for p in active_payments if p.hosting_charge_id is not None)
    refunds_cents = sum(p.refunded_cents for p in active_payments)

    projects_by_id: dict[uuid.UUID, Project | None] = {}
    clients_by_id: dict[uuid.UUID, Client | None] = {}
    transactions: list[RevenueTransaction] = []
    for p in all_payments:
        if p.project_id not in projects_by_id:
            projects_by_id[p.project_id] = db.get(Project, p.project_id)
        project = projects_by_id[p.project_id]

        client_business_name = None
        if p.client_id is not None:
            if p.client_id not in clients_by_id:
                clients_by_id[p.client_id] = db.scalar(
                    select(Client).options(joinedload(Client.business)).where(Client.id == p.client_id)
                )
            client = clients_by_id[p.client_id]
            client_business_name = client.business.name if client else None

        transactions.append(
            RevenueTransaction(
                payment_id=p.id,
                project_id=p.project_id,
                project_name=project.name if project else "",
                client_id=p.client_id,
                client_business_name=client_business_name,
                kind="website" if p.website_agreement_id is not None else "hosting",
                amount_cents=p.amount_cents,
                net_cents=_net_cents(p),
                received_date=p.received_date,
                method=p.method,
                reference=p.reference,
                notes=p.notes,
                refunded_cents=p.refunded_cents,
                voided=p.voided_at is not None,
                voided_reason=p.voided_reason,
            )
        )

    mrr = get_mrr(db, workspace_id=workspace_id)
    today = today_in_workspace(db, workspace_id)
    rows = _balance_rows(db, workspace_id, today)
    outstanding_total = sum(r.outstanding_cents for r in rows)
    overdue_rows = [r for r in rows if r.is_overdue]

    return RevenueReport(
        start_date=start_date,
        end_date=end_date,
        website_payments_received_cents=website_cents,
        hosting_payments_received_cents=hosting_cents,
        total_payments_received_cents=website_cents + hosting_cents,
        refunds_cents=refunds_cents,
        expected_mrr_cents=mrr,
        outstanding_balance_cents=outstanding_total,
        overdue_cents=sum(r.outstanding_cents for r in overdue_rows),
        overdue_count=len(overdue_rows),
        transactions=transactions,
    )


def _days_relative(due_date: date | None, today: date) -> int | None:
    return None if due_date is None else (due_date - today).days


def _obligations_for_project(
    db: Session,
    *,
    workspace_id: uuid.UUID,
    project: Project,
    today: date,
    client_id: uuid.UUID | None,
    client_business_name: str | None,
) -> list[NextPaymentObligation]:
    """
    Every unpaid scheduled obligation for one project — its website
    agreement (if any) and each of its hosting plans' charges plus (for
    ACTIVE plans only) the not-yet-generated next charge, projected from
    the plan's own next_due_date/monthly_fee_cents so it's visible before
    the sweep job actually creates it. Once that charge is generated, the
    real HostingCharge row takes over from the projection for the same
    period — `generate_charge_if_missing`'s own idempotency (one row per
    (plan, billing_period)) is what prevents ever counting both, since a
    plan's `next_due_date` only advances when its charge is generated.
    Shared by the per-client (`get_next_payment_summary`) and
    workspace-wide (`get_workspace_obligations`) callers so the two never
    drift into different rules for the same underlying obligation.
    """
    obligations: list[NextPaymentObligation] = []

    agreement = get_agreement_for_project(db, workspace_id=workspace_id, project_id=project.id)
    if agreement is not None and agreement.price_cents is not None:
        paid = sum(_net_cents(p) for p in agreement.payments)
        outstanding = agreement.price_cents - paid
        if outstanding > 0:
            is_deposit = agreement.deposit_required_cents is not None and paid < agreement.deposit_required_cents
            # The deposit obligation's amount is what's left to satisfy the
            # deposit itself, not the whole remaining project balance —
            # those only coincide once the deposit is fully paid.
            amount_due = agreement.deposit_required_cents - paid if is_deposit else outstanding
            obligations.append(
                NextPaymentObligation(
                    kind="website_deposit" if is_deposit else "website_balance",
                    project_id=project.id,
                    project_name=project.name,
                    client_id=client_id,
                    client_business_name=client_business_name,
                    amount_cents=amount_due,
                    due_date=agreement.due_date,
                    is_overdue=agreement.due_date is not None and agreement.due_date < today,
                    days_relative=_days_relative(agreement.due_date, today),
                    website_agreement_id=agreement.id,
                    hosting_charge_id=None,
                    hosting_plan_id=None,
                    scheduled=False,
                )
            )

    plans = list(db.scalars(select(HostingPlan).where(HostingPlan.project_id == project.id)))
    for plan in plans:
        charges = list(
            db.scalars(
                select(HostingCharge)
                .where(HostingCharge.hosting_plan_id == plan.id)
                .options(joinedload(HostingCharge.payments))
            ).unique()
        )
        due_periods = set()
        for charge in charges:
            due_periods.add(charge.billing_period)
            paid = sum(_net_cents(p) for p in charge.payments)
            outstanding = max(0, charge.amount_cents - paid)
            if outstanding > 0:
                obligations.append(
                    NextPaymentObligation(
                        kind="hosting_charge",
                        project_id=project.id,
                        project_name=project.name,
                        client_id=client_id,
                        client_business_name=client_business_name,
                        amount_cents=outstanding,
                        due_date=charge.due_date,
                        is_overdue=charge.due_date < today,
                        days_relative=_days_relative(charge.due_date, today),
                        website_agreement_id=None,
                        hosting_charge_id=charge.id,
                        hosting_plan_id=plan.id,
                        scheduled=False,
                    )
                )

        # Paused/cancelled plans never produce a *new* expected payment
        # (their existing charges above still count) — only an ACTIVE
        # plan projects a not-yet-generated next charge.
        if plan.status == HostingPlanStatus.ACTIVE:
            next_period = date(plan.next_due_date.year, plan.next_due_date.month, 1)
            if next_period not in due_periods:
                obligations.append(
                    NextPaymentObligation(
                        kind="hosting_scheduled",
                        project_id=project.id,
                        project_name=project.name,
                        client_id=client_id,
                        client_business_name=client_business_name,
                        amount_cents=plan.monthly_fee_cents,
                        due_date=plan.next_due_date,
                        is_overdue=plan.next_due_date < today,
                        days_relative=_days_relative(plan.next_due_date, today),
                        website_agreement_id=None,
                        hosting_charge_id=None,
                        hosting_plan_id=plan.id,
                        scheduled=True,
                    )
                )

    return obligations


def get_next_payment_summary(db: Session, *, workspace_id: uuid.UUID, client_id: uuid.UUID) -> NextPaymentSummary:
    """The earliest unpaid scheduled obligation across every one of the client's projects and hosting plans."""
    today = today_in_workspace(db, workspace_id)
    client = db.scalar(select(Client).options(joinedload(Client.business)).where(Client.id == client_id))
    client_business_name = client.business.name if client else None
    projects = list(
        db.scalars(select(Project).where(Project.workspace_id == workspace_id, Project.client_id == client_id))
    )

    obligations: list[NextPaymentObligation] = []
    for project in projects:
        obligations += _obligations_for_project(
            db,
            workspace_id=workspace_id,
            project=project,
            today=today,
            client_id=client_id,
            client_business_name=client_business_name,
        )

    with_date = [o for o in obligations if o.due_date is not None]
    without_date = [o for o in obligations if o.due_date is None]

    overdue_candidates = [o for o in with_date if o.is_overdue]
    upcoming_candidates = [o for o in with_date if not o.is_overdue]

    def earliest_tied(candidates: list[NextPaymentObligation]) -> list[NextPaymentObligation]:
        if not candidates:
            return []
        earliest = min(o.due_date for o in candidates)  # type: ignore[type-var]
        return [o for o in candidates if o.due_date == earliest]

    return NextPaymentSummary(
        overdue=earliest_tied(overdue_candidates),
        upcoming=earliest_tied(upcoming_candidates),
        no_due_date_cents=sum(o.amount_cents for o in without_date),
        no_due_date_count=len(without_date),
    )


def get_workspace_obligations(db: Session, *, workspace_id: uuid.UUID) -> list[NextPaymentObligation]:
    """
    Every unpaid scheduled obligation across every Client's projects and
    hosting plans in the workspace — the full list (not just the
    earliest, unlike `get_next_payment_summary`), for the Revenue page's
    Upcoming & Overdue tab to group by overdue/due-today/next-7-days/
    later/no-due-date itself.
    """
    today = today_in_workspace(db, workspace_id)
    projects = list(db.scalars(select(Project).where(Project.workspace_id == workspace_id)))
    clients_by_id: dict[uuid.UUID, Client | None] = {}

    obligations: list[NextPaymentObligation] = []
    for project in projects:
        client_business_name = None
        if project.client_id is not None:
            if project.client_id not in clients_by_id:
                clients_by_id[project.client_id] = db.scalar(
                    select(Client).options(joinedload(Client.business)).where(Client.id == project.client_id)
                )
            client = clients_by_id[project.client_id]
            client_business_name = client.business.name if client else None

        obligations += _obligations_for_project(
            db,
            workspace_id=workspace_id,
            project=project,
            today=today,
            client_id=project.client_id,
            client_business_name=client_business_name,
        )

    return obligations


def list_all_hosting_plans(db: Session, *, workspace_id: uuid.UUID) -> list[RevenueHostingPlan]:
    """Every hosting plan in the workspace, with its client/project names and current outstanding balance."""
    plans = list(
        db.scalars(
            select(HostingPlan)
            .where(HostingPlan.workspace_id == workspace_id)
            .options(
                joinedload(HostingPlan.project),
                joinedload(HostingPlan.charges).joinedload(HostingCharge.payments),
            )
        ).unique()
    )
    clients_by_id: dict[uuid.UUID, Client | None] = {}

    rows: list[RevenueHostingPlan] = []
    for plan in plans:
        project = plan.project
        client_business_name = None
        if project.client_id is not None:
            if project.client_id not in clients_by_id:
                clients_by_id[project.client_id] = db.scalar(
                    select(Client).options(joinedload(Client.business)).where(Client.id == project.client_id)
                )
            client = clients_by_id[project.client_id]
            client_business_name = client.business.name if client else None

        outstanding = sum(
            max(0, charge.amount_cents - sum(_net_cents(p) for p in charge.payments)) for charge in plan.charges
        )
        rows.append(
            RevenueHostingPlan(
                id=plan.id,
                project_id=plan.project_id,
                status=plan.status,
                monthly_fee_cents=plan.monthly_fee_cents,
                start_date=plan.start_date,
                billing_day=plan.billing_day,
                next_due_date=plan.next_due_date,
                paused_effective_date=plan.paused_effective_date,
                cancelled_effective_date=plan.cancelled_effective_date,
                created_at=plan.created_at,
                updated_at=plan.updated_at,
                client_id=project.client_id,
                client_business_name=client_business_name,
                project_name=project.name,
                outstanding_cents=outstanding,
            )
        )

    return rows


UPCOMING_PAYMENTS_PREVIEW_LIMIT = 5


def get_today_snapshot(db: Session, *, workspace_id: uuid.UUID) -> TodayBillingSnapshot:
    """
    The Today dashboard's compact Revenue section — every figure reuses
    the exact same helpers as the Revenue page itself (`_balance_rows`
    for the overdue total, `get_mrr`, `get_workspace_obligations` for
    the upcoming preview) rather than a second, parallel calculation, so
    the two pages can never silently disagree.
    """
    today = today_in_workspace(db, workspace_id)
    month_start = today.replace(day=1)
    received = get_payments_received(db, workspace_id=workspace_id, start_date=month_start, end_date=today)

    rows = _balance_rows(db, workspace_id, today)
    overdue_rows = [r for r in rows if r.is_overdue]
    overdue_client_count = len({r.client_id for r in overdue_rows if r.client_id is not None})

    obligations = get_workspace_obligations(db, workspace_id=workspace_id)
    upcoming = sorted(
        (o for o in obligations if not o.is_overdue and o.due_date is not None),
        key=lambda o: o.due_date,  # type: ignore[union-attr, return-value]
    )[:UPCOMING_PAYMENTS_PREVIEW_LIMIT]

    return TodayBillingSnapshot(
        payments_received_this_month_cents=received,
        expected_mrr_cents=get_mrr(db, workspace_id=workspace_id),
        overdue_cents=sum(r.outstanding_cents for r in overdue_rows),
        overdue_client_count=overdue_client_count,
        upcoming_payments=upcoming,
    )
