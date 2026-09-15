import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

# ---- Website agreement ----


class WebsiteAgreementUpsert(BaseModel):
    price_cents: int | None = None
    deposit_required_cents: int | None = None
    due_date: date | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _deposit_within_price(self) -> "WebsiteAgreementUpsert":
        if (
            self.deposit_required_cents is not None
            and self.price_cents is not None
            and self.deposit_required_cents > self.price_cents
        ):
            raise ValueError("deposit_required_cents cannot exceed price_cents")
        return self


class WebsiteAgreementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    price_cents: int | None
    deposit_required_cents: int | None
    due_date: date | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


# ---- Hosting plan ----


class HostingPlanCreate(BaseModel):
    monthly_fee_cents: int
    start_date: date
    billing_day: int

    @model_validator(mode="after")
    def _billing_day_range(self) -> "HostingPlanCreate":
        if not 1 <= self.billing_day <= 31:
            raise ValueError("billing_day must be between 1 and 31")
        return self


class HostingPlanEffectiveDate(BaseModel):
    effective_date: date
    reason: str | None = None


class HostingPlanFeeChange(BaseModel):
    new_monthly_fee_cents: int
    effective_date: date


class HostingPlanRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    status: str
    monthly_fee_cents: int
    start_date: date
    billing_day: int
    next_due_date: date
    paused_effective_date: date | None
    cancelled_effective_date: date | None
    created_at: datetime
    updated_at: datetime


# ---- Payments ----


class PaymentAllocation(BaseModel):
    type: Literal["agreement", "hosting_charge"]
    id: uuid.UUID


class PaymentCreate(BaseModel):
    project_id: uuid.UUID
    allocation: PaymentAllocation
    amount_cents: int
    received_date: date
    method: str | None = None
    reference: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _positive_amount(self) -> "PaymentCreate":
        if self.amount_cents <= 0:
            raise ValueError("amount_cents must be positive")
        return self


class PaymentVoid(BaseModel):
    reason: str


class PaymentRefund(BaseModel):
    refund_amount_cents: int
    reason: str


class PaymentRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    client_id: uuid.UUID | None
    website_agreement_id: uuid.UUID | None
    hosting_charge_id: uuid.UUID | None
    amount_cents: int
    received_date: date
    method: str | None
    reference: str | None
    notes: str | None
    refunded_cents: int
    voided_at: datetime | None
    voided_reason: str | None
    # amount_cents - refunded_cents, or 0 if voided — the payment's net
    # contribution to "payments received" reporting.
    net_cents: int
    created_at: datetime


class HostingChargeRead(BaseModel):
    id: uuid.UUID
    hosting_plan_id: uuid.UUID
    billing_period: date
    due_date: date
    amount_cents: int
    paid_cents: int
    outstanding_cents: int
    is_overdue: bool


class HostingChargeDueDateUpdate(BaseModel):
    due_date: date


# ---- Reporting shapes ----


class BalanceRow(BaseModel):
    kind: Literal["agreement", "hosting_charge"]
    id: uuid.UUID
    project_id: uuid.UUID
    client_id: uuid.UUID | None
    label: str
    total_cents: int
    paid_cents: int
    outstanding_cents: int
    due_date: date | None
    is_overdue: bool


class ClientBillingProject(BaseModel):
    project_id: uuid.UUID
    project_name: str
    agreement: WebsiteAgreementRead | None
    agreement_paid_cents: int
    agreement_outstanding_cents: int
    hosting_plans: list[HostingPlanRead]


class ClientBillingSummary(BaseModel):
    client_id: uuid.UUID
    projects: list[ClientBillingProject]
    payments: list[PaymentRead]


class ProjectPaymentSummary(BaseModel):
    project_id: uuid.UUID
    client_id: uuid.UUID | None
    agreement: WebsiteAgreementRead | None
    price_cents: int | None
    paid_cents: int
    outstanding_cents: int
    status: Literal["unconfigured", "unpaid", "partially_paid", "paid", "overpaid"]
    hosting_plans: list[HostingPlanRead]
    payments: list[PaymentRead]


class RevenueTransaction(BaseModel):
    payment_id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    client_id: uuid.UUID | None
    client_business_name: str | None
    kind: Literal["website", "hosting"]
    amount_cents: int
    net_cents: int
    received_date: date
    method: str | None
    reference: str | None
    notes: str | None
    # Full detail carried on every row (not just enough for the table) so
    # the Revenue page's compact detail panel can open the existing
    # correction/refund flow directly from a row without a second fetch.
    refunded_cents: int
    voided: bool
    voided_reason: str | None


class RevenueReport(BaseModel):
    start_date: date
    end_date: date
    website_payments_received_cents: int
    hosting_payments_received_cents: int
    total_payments_received_cents: int
    # Total refunded in this period, already netted out of the three
    # fields above — broken out separately so the UI can show it as its
    # own line in the receipts breakdown rather than only implicitly.
    refunds_cents: int
    expected_mrr_cents: int
    outstanding_balance_cents: int
    overdue_cents: int
    overdue_count: int
    # transactions includes voided/reversed payments too (for display —
    # every total above is still computed net of them); the frontend
    # distinguishes reversed rows via `voided`.
    transactions: list[RevenueTransaction]


# ---- Next payment due ----

# "website_deposit"/"website_balance" split on the same WebsiteAgreement:
# deposit while paid-so-far hasn't covered deposit_required_cents yet,
# balance once it has (or when no deposit was ever required) — mirrors
# how a payment against that agreement is understood everywhere else.
NextPaymentKind = Literal["website_deposit", "website_balance", "hosting_charge", "hosting_scheduled"]


class NextPaymentObligation(BaseModel):
    kind: NextPaymentKind
    project_id: uuid.UUID
    project_name: str
    # Set for every obligation (workspace-wide listings need it to show
    # which client a row belongs to); the per-client caller already knows
    # the client from context, so these are somewhat redundant there but
    # harmless to include for one shared shape.
    client_id: uuid.UUID | None = None
    client_business_name: str | None = None
    amount_cents: int
    due_date: date | None
    is_overdue: bool
    # Positive = days until due, negative = days overdue, 0 = due today.
    # None only when due_date is None.
    days_relative: int | None
    website_agreement_id: uuid.UUID | None
    hosting_charge_id: uuid.UUID | None
    hosting_plan_id: uuid.UUID | None
    # True only for a hosting obligation whose charge row doesn't exist
    # yet — the plan's own next_due_date/monthly_fee_cents, projected
    # forward so it's visible before the sweep job actually creates it.
    scheduled: bool


class NextPaymentSummary(BaseModel):
    # All obligations that share the single earliest overdue due_date
    # (usually one; more than one only on a genuine tie) — empty if
    # nothing is overdue.
    overdue: list[NextPaymentObligation]
    # Same shape for the earliest upcoming (due today or later) date.
    upcoming: list[NextPaymentObligation]
    # Outstanding obligations with no due date at all — tracked
    # separately since they can't be placed on the overdue/upcoming
    # timeline at all.
    no_due_date_cents: int
    no_due_date_count: int


# ---- Revenue page: hosting plans (workspace-wide) ----


class RevenueHostingPlan(HostingPlanRead):
    client_id: uuid.UUID | None
    client_business_name: str | None
    project_name: str
    outstanding_cents: int


# ---- Today dashboard: compact revenue summary ----


class TodayBillingSnapshot(BaseModel):
    payments_received_this_month_cents: int
    expected_mrr_cents: int
    overdue_cents: int
    # Distinct Clients with at least one overdue obligation — not a raw
    # overdue-row count, so one Client with three overdue charges still
    # reads as "1 client", matching how an operator would actually think
    # about it ("who do I need to chase") rather than "how many rows".
    overdue_client_count: int
    # A short, earliest-first slice (not the full list — see
    # /dashboard/revenue?tab=upcoming for that) of non-overdue upcoming
    # obligations, reusing the exact same shape/rules as the Revenue
    # page's own Upcoming & Overdue tab.
    upcoming_payments: list[NextPaymentObligation]
