"""create billing tables

Revision ID: 7d7fce74afb1
Revises: a70862227ac7
Create Date: 2026-09-14 20:26:21.847961

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '7d7fce74afb1'
down_revision: Union[str, None] = 'a70862227ac7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Labels are the Python enum's *names* (upper-case) — same convention as
# every other enum in this codebase. create_type=False: created once via
# the explicit .create() call below, not implicitly by create_table's
# column-type visitor (both firing in the same transaction raises "type
# already exists" — a bug this codebase has hit and fixed before).
hosting_plan_status = postgresql.ENUM(
    'ACTIVE', 'PAUSED', 'CANCELLED', name='hosting_plan_status', create_type=False
)


def upgrade() -> None:
    hosting_plan_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'website_agreements',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('workspace_id', sa.UUID(), nullable=False),
        sa.Column('price_cents', sa.Integer(), nullable=True),
        sa.Column('deposit_required_cents', sa.Integer(), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id'),
    )
    op.create_index('ix_website_agreements_workspace_id', 'website_agreements', ['workspace_id'])

    op.create_table(
        'hosting_plans',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('workspace_id', sa.UUID(), nullable=False),
        sa.Column('status', hosting_plan_status, nullable=False, server_default='ACTIVE'),
        sa.Column('monthly_fee_cents', sa.Integer(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('billing_day', sa.Integer(), nullable=False),
        sa.Column('next_due_date', sa.Date(), nullable=False),
        sa.Column('paused_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('paused_effective_date', sa.Date(), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_effective_date', sa.Date(), nullable=True),
        sa.Column('fee_changed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_hosting_plans_project_id', 'hosting_plans', ['project_id'])
    op.create_index('ix_hosting_plans_workspace_id', 'hosting_plans', ['workspace_id'])

    op.create_table(
        'hosting_charges',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('hosting_plan_id', sa.UUID(), nullable=False),
        sa.Column('workspace_id', sa.UUID(), nullable=False),
        sa.Column('billing_period', sa.Date(), nullable=False),
        sa.Column('due_date', sa.Date(), nullable=False),
        sa.Column('amount_cents', sa.Integer(), nullable=False),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['hosting_plan_id'], ['hosting_plans.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('hosting_plan_id', 'billing_period', name='uq_hosting_charge_plan_period'),
    )
    op.create_index('ix_hosting_charges_hosting_plan_id', 'hosting_charges', ['hosting_plan_id'])
    op.create_index('ix_hosting_charges_workspace_id', 'hosting_charges', ['workspace_id'])

    op.create_table(
        'payments',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('workspace_id', sa.UUID(), nullable=False),
        sa.Column('client_id', sa.UUID(), nullable=True),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('website_agreement_id', sa.UUID(), nullable=True),
        sa.Column('hosting_charge_id', sa.UUID(), nullable=True),
        sa.Column('amount_cents', sa.Integer(), nullable=False),
        sa.Column('received_date', sa.Date(), nullable=False),
        sa.Column('method', sa.String(length=40), nullable=True),
        sa.Column('reference', sa.String(length=120), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('refunded_cents', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('voided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('voided_reason', sa.Text(), nullable=True),
        sa.Column('recorded_by_user_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['website_agreement_id'], ['website_agreements.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['hosting_charge_id'], ['hosting_charges.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['recorded_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            '(website_agreement_id IS NOT NULL) != (hosting_charge_id IS NOT NULL)',
            name='ck_payment_single_allocation',
        ),
        sa.CheckConstraint(
            'refunded_cents >= 0 AND refunded_cents <= amount_cents', name='ck_payment_refund_bounds'
        ),
    )
    op.create_index('ix_payments_workspace_id', 'payments', ['workspace_id'])
    op.create_index('ix_payments_client_id', 'payments', ['client_id'])
    op.create_index('ix_payments_project_id', 'payments', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_payments_project_id', table_name='payments')
    op.drop_index('ix_payments_client_id', table_name='payments')
    op.drop_index('ix_payments_workspace_id', table_name='payments')
    op.drop_table('payments')

    op.drop_index('ix_hosting_charges_workspace_id', table_name='hosting_charges')
    op.drop_index('ix_hosting_charges_hosting_plan_id', table_name='hosting_charges')
    op.drop_table('hosting_charges')

    op.drop_index('ix_hosting_plans_workspace_id', table_name='hosting_plans')
    op.drop_index('ix_hosting_plans_project_id', table_name='hosting_plans')
    op.drop_table('hosting_plans')

    op.drop_index('ix_website_agreements_workspace_id', table_name='website_agreements')
    op.drop_table('website_agreements')

    hosting_plan_status.drop(op.get_bind(), checkfirst=True)
