"""email_sends table

Revision ID: a7c3f9e51b26
Revises: b3a7c5e1f048
Create Date: 2026-08-24 00:00:00.000000

Backs the email outreach integration layer (app/integrations/email.py):
one row per attempt to actually dispatch an approved EMAIL outreach
message through a provider adapter, distinct from
outreach_messages.status/sent_at (the operator's own channel-agnostic
"this went out" bookkeeping). A message can accumulate more than one row
if a send fails and the operator retries — that sequence of attempts is
the email history / failure-handling record this table exists to keep.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a7c3f9e51b26'
down_revision: Union[str, None] = 'b3a7c5e1f048'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'email_sends',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('outreach_message_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('to_email', sa.String(length=255), nullable=False),
        sa.Column('from_email', sa.String(length=255), nullable=False),
        sa.Column('subject', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('provider', sa.String(length=50), nullable=False),
        sa.Column('status', postgresql.ENUM('SENT', 'FAILED', name='email_send_status'), nullable=False),
        sa.Column('provider_message_id', sa.String(length=255), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('sent_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['outreach_message_id'], ['outreach_messages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sent_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_email_sends_lead_id', 'email_sends', ['lead_id'])
    op.create_index('ix_email_sends_outreach_message_id', 'email_sends', ['outreach_message_id'])


def downgrade() -> None:
    op.drop_index('ix_email_sends_outreach_message_id', table_name='email_sends')
    op.drop_index('ix_email_sends_lead_id', table_name='email_sends')
    op.drop_table('email_sends')

    sa.Enum(name='email_send_status').drop(op.get_bind())
