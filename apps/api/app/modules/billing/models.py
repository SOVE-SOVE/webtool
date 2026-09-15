import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.modules.clients.models import Client
    from app.modules.projects.models import Project
    from app.modules.users.models import User


class HostingPlanStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    CANCELLED = "cancelled"


class WebsiteAgreement(Base):
    """
    The agreed terms of a Project's one-off website purchase — price,
    optional deposit, and due date. 1:1 with Project, created lazily on
    the first "set agreement" action (never auto-created alongside a
    Project). `price_cents` is nullable: NULL means the price hasn't
    been configured yet, `0` means a genuine free/zero-price agreement
    — same convention Project.price_cents already uses. A deposit is
    part of `price_cents`, not an additional charge; there is no
    separate "deposit paid" flag — any Payment allocated here counts
    toward the same balance, deposit or not.
    """

    __tablename__ = "website_agreements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    price_cents: Mapped[int | None] = mapped_column(Integer)
    deposit_required_cents: Mapped[int | None] = mapped_column(Integer)
    due_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship()
    payments: Mapped[list["Payment"]] = relationship(back_populates="website_agreement")


class HostingPlan(Base):
    """
    A recurring monthly hosting agreement for a Project. Many are
    allowed per Project (a Client's multiple plans come from its
    multiple Projects, not from stacking plans on one Project).
    `next_due_date` is advanced by the hosting-billing sweep job
    (app/jobs/handlers.py::handle_hosting_billing_sweep) after each
    charge it generates; pausing/cancelling freezes it in place so a
    later resume picks up exactly where it left off rather than
    generating a backlog for the paused period.
    """

    __tablename__ = "hosting_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    status: Mapped[HostingPlanStatus] = mapped_column(
        Enum(HostingPlanStatus, name="hosting_plan_status"), default=HostingPlanStatus.ACTIVE
    )
    monthly_fee_cents: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[date] = mapped_column(Date)
    billing_day: Mapped[int] = mapped_column(Integer)
    next_due_date: Mapped[date] = mapped_column(Date)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paused_effective_date: Mapped[date | None] = mapped_column(Date)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_effective_date: Mapped[date | None] = mapped_column(Date)
    fee_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship()
    charges: Mapped[list["HostingCharge"]] = relationship(back_populates="hosting_plan")


class HostingCharge(Base):
    """
    One row per billing period per plan, generated only by the hosting-
    billing sweep job — never created by hand. `amount_cents` snapshots
    the plan's fee at generation time so a later fee change doesn't
    rewrite history. No status column: "paid" is always derived from
    allocated Payment rows, so pausing/cancelling a plan can never
    silently mark or erase a charge.
    """

    __tablename__ = "hosting_charges"
    __table_args__ = (
        UniqueConstraint("hosting_plan_id", "billing_period", name="uq_hosting_charge_plan_period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hosting_plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hosting_plans.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    billing_period: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)
    amount_cents: Mapped[int] = mapped_column(Integer)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    hosting_plan: Mapped["HostingPlan"] = relationship(back_populates="charges")
    payments: Mapped[list["Payment"]] = relationship(back_populates="hosting_charge")


class Payment(Base):
    """
    A manually recorded payment, allocated to exactly one of a
    WebsiteAgreement (a website-purchase/deposit payment) or a specific
    HostingCharge (a recurring hosting payment). Never deleted — a
    correction either voids it (`voided_at` set, fully excluded from
    totals) or partially refunds it (`refunded_cents` increased; net
    contribution to "payments received" = amount_cents - refunded_cents),
    both leaving the row visible in history for the audit trail.
    """

    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "(website_agreement_id IS NOT NULL) != (hosting_charge_id IS NOT NULL)",
            name="ck_payment_single_allocation",
        ),
        CheckConstraint(
            "refunded_cents >= 0 AND refunded_cents <= amount_cents", name="ck_payment_refund_bounds"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    # Denormalized for fast client-billing-page queries; null when the
    # payment is against a prospect Project's agreement (no Client yet).
    client_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    website_agreement_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("website_agreements.id", ondelete="SET NULL")
    )
    hosting_charge_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("hosting_charges.id", ondelete="SET NULL")
    )
    amount_cents: Mapped[int] = mapped_column(Integer)
    received_date: Mapped[date] = mapped_column(Date)
    method: Mapped[str | None] = mapped_column(String(40))
    reference: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    refunded_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_reason: Mapped[str | None] = mapped_column(Text)
    recorded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped["Project"] = relationship()
    client: Mapped["Client | None"] = relationship()
    website_agreement: Mapped["WebsiteAgreement | None"] = relationship(back_populates="payments")
    hosting_charge: Mapped["HostingCharge | None"] = relationship(back_populates="payments")
    recorded_by_user: Mapped["User | None"] = relationship()
