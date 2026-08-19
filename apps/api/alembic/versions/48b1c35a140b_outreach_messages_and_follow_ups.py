"""outreach messages and follow ups

Revision ID: 48b1c35a140b
Revises: a3f8c1d92b44
Create Date: 2026-08-18 08:09:59.661730

Backs the Sales Outreach + Follow-up feature. Drafting-only per
docs/03_AGENT_RULES.md — status only ever advances via an explicit
operator action recorded on the row (approved_by/sent_by/closed_by),
never automatically.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '48b1c35a140b'
down_revision: Union[str, None] = 'a3f8c1d92b44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # create_type=False on the reused Enum object below: it's created
    # explicitly once here, then referenced (not re-created) by both
    # outreach_messages.channel and follow_ups.channel.
    outreach_channel = postgresql.ENUM('EMAIL', 'PHONE', 'IN_PERSON', name='outreach_channel', create_type=False)
    outreach_channel.create(op.get_bind())

    op.create_table(
        'outreach_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('based_on_sales_audit_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('channel', outreach_channel, nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM('DRAFTED', 'APPROVED', 'SENT', 'REPLIED', 'FOLLOW_UP_DUE', 'CLOSED', name='outreach_status'),
            nullable=False,
            server_default='DRAFTED',
        ),
        sa.Column('subject', sa.String(length=255), nullable=True),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('opening_line', sa.Text(), nullable=True),
        sa.Column('key_points', sa.Text(), nullable=True),
        sa.Column('objection_handling', sa.Text(), nullable=True),
        sa.Column('suggested_close', sa.Text(), nullable=True),
        sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('model_used', sa.String(length=100), nullable=False),
        sa.Column('prompt_version', sa.String(length=50), nullable=False),
        sa.Column('generated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('approved_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sent_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('replied_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['based_on_sales_audit_id'], ['sales_audit_reports.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['generated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['sent_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['closed_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'follow_ups',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('outreach_message_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('channel', outreach_channel, nullable=False),
        sa.Column('due_date', sa.Date(), nullable=False),
        sa.Column('suggested_next_action', sa.Text(), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM('PENDING', 'DONE', name='follow_up_status'),
            nullable=False,
            server_default='PENDING',
        ),
        sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('model_used', sa.String(length=100), nullable=False),
        sa.Column('prompt_version', sa.String(length=50), nullable=False),
        sa.Column('generated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('resolved_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['outreach_message_id'], ['outreach_messages.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['generated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['resolved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('follow_ups')
    op.drop_table('outreach_messages')

    sa.Enum(name='follow_up_status').drop(op.get_bind())
    sa.Enum(name='outreach_status').drop(op.get_bind())
    sa.Enum(name='outreach_channel').drop(op.get_bind())
