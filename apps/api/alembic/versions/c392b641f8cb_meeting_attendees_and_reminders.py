"""meeting_attendees and meeting_reminders

Revision ID: c392b641f8cb
Revises: e8b2f4a91c3d
Create Date: 2026-08-24 00:00:00.000000

Backs the calendar-integration adapter pass (see docs/05_DECISIONS.md):
per-meeting attendee information and reminders. Both are new, purely
additive tables — nothing pre-existing changes shape. `meetings` still
has no calendar-adapter behavior change to its own columns; this
migration only adds the two child tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c392b641f8cb'
down_revision: Union[str, None] = 'e8b2f4a91c3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'meeting_attendees',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('meeting_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('is_organizer', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_meeting_attendees_meeting_id', 'meeting_attendees', ['meeting_id']
    )

    reminder_channel = sa.Enum('IN_APP', name='meeting_reminder_channel')
    reminder_channel.create(op.get_bind())

    op.create_table(
        'meeting_reminders',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('meeting_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('remind_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('channel', reminder_channel, nullable=False, server_default='IN_APP'),
        sa.Column('note', sa.String(length=255), nullable=True),
        sa.Column('acknowledged_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_meeting_reminders_meeting_id', 'meeting_reminders', ['meeting_id']
    )


def downgrade() -> None:
    op.drop_index('ix_meeting_reminders_meeting_id', table_name='meeting_reminders')
    op.drop_table('meeting_reminders')
    sa.Enum(name='meeting_reminder_channel').drop(op.get_bind())

    op.drop_index('ix_meeting_attendees_meeting_id', table_name='meeting_attendees')
    op.drop_table('meeting_attendees')
