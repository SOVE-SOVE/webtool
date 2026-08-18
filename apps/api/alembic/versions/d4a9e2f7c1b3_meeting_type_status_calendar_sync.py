"""meetings: type/status/assigned_user/duration/external_event_id; meeting_briefs; calendar_connections

Revision ID: d4a9e2f7c1b3
Revises: c2f4a8d1e6b7
Create Date: 2026-08-18 11:00:00.000000

Backs the Calendar Integration feature: Google Calendar OAuth (per user,
encrypted refresh token — see app/core/crypto.py and
docs/06_SECURITY.md), auto meeting-brief generation on booking, and the
richer meeting fields (type/status/assigned user/duration) the workflow
needs. `meetings` still has zero real rows (this branch's own feature,
never deployed) so these are added directly rather than backfilled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4a9e2f7c1b3'
down_revision: Union[str, None] = 'c2f4a8d1e6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    meeting_type = sa.Enum('SALES_CALL', 'CLIENT_CHECK_IN', 'OTHER', name='meeting_type')
    meeting_status = sa.Enum('SCHEDULED', 'HELD', 'CANCELLED', 'NO_SHOW', name='meeting_status')
    meeting_type.create(op.get_bind())
    meeting_status.create(op.get_bind())

    op.add_column(
        'meetings',
        sa.Column('meeting_type', meeting_type, nullable=False, server_default='OTHER'),
    )
    op.add_column(
        'meetings',
        sa.Column('status', meeting_status, nullable=False, server_default='SCHEDULED'),
    )
    op.add_column(
        'meetings', sa.Column('duration_minutes', sa.Integer(), nullable=False, server_default='30')
    )
    op.add_column(
        'meetings', sa.Column('assigned_user_id', postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column('meetings', sa.Column('external_event_id', sa.String(length=255), nullable=True))
    op.create_foreign_key(
        'meetings_assigned_user_id_fkey', 'meetings', 'users', ['assigned_user_id'], ['id'], ondelete='SET NULL'
    )

    op.create_table(
        'meeting_briefs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('meeting_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('talking_points', sa.Text(), nullable=False),
        sa.Column('open_items', sa.Text(), nullable=False),
        sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('model_used', sa.String(length=100), nullable=False),
        sa.Column('prompt_version', sa.String(length=50), nullable=False),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('meeting_id'),
    )

    op.create_table(
        'calendar_connections',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False, server_default='google'),
        sa.Column('google_email', sa.String(length=255), nullable=True),
        sa.Column('encrypted_refresh_token', sa.Text(), nullable=False),
        sa.Column('calendar_id', sa.String(length=255), nullable=False, server_default='primary'),
        sa.Column('connected_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )


def downgrade() -> None:
    op.drop_table('calendar_connections')
    op.drop_table('meeting_briefs')

    op.drop_constraint('meetings_assigned_user_id_fkey', 'meetings', type_='foreignkey')
    op.drop_column('meetings', 'external_event_id')
    op.drop_column('meetings', 'assigned_user_id')
    op.drop_column('meetings', 'duration_minutes')
    op.drop_column('meetings', 'status')
    op.drop_column('meetings', 'meeting_type')

    sa.Enum(name='meeting_status').drop(op.get_bind())
    sa.Enum(name='meeting_type').drop(op.get_bind())
