"""client checklist

Revision ID: 32118c81e86f
Revises: ca0a45a263c8
Create Date: 2026-09-13 16:49:01.679155

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '32118c81e86f'
down_revision: Union[str, None] = 'ca0a45a263c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Labels are the Python enum's *names* (upper-case) — same convention as
# every other enum this session added. create_type=False: created once
# via the explicit .create() calls below, not implicitly by
# create_table's column-type visitor (both firing in the same
# transaction raises "type already exists" — a bug hit and fixed twice
# already in this codebase's history).
checklist_completion_mode = postgresql.ENUM(
    'AUTOMATIC', 'MANUAL', name='checklist_completion_mode', create_type=False
)
checklist_item_status = postgresql.ENUM(
    'PENDING', 'COMPLETE', 'NOT_REQUIRED', name='checklist_item_status', create_type=False
)
checklist_auto_signal = postgresql.ENUM(
    'WEBSITE_SCOPE_CONFIRMED',
    'DIRECTION_APPROVED',
    'CONTENT_APPROVED',
    'PREVIEW_BUILT',
    'QA_COMPLETE',
    'LAUNCH_APPROVED',
    'WEBSITE_LAUNCHED',
    name='checklist_auto_signal',
    create_type=False,
)


def upgrade() -> None:
    checklist_completion_mode.create(op.get_bind(), checkfirst=True)
    checklist_item_status.create(op.get_bind(), checkfirst=True)
    checklist_auto_signal.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'client_checklist_items',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('client_id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('completion_mode', checklist_completion_mode, nullable=False, server_default='MANUAL'),
        sa.Column('auto_signal', checklist_auto_signal, nullable=True),
        sa.Column('status', checklist_item_status, nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_by_user_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['completed_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_client_checklist_items_client_id', 'client_checklist_items', ['client_id'])
    op.create_index('ix_client_checklist_items_project_id', 'client_checklist_items', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_client_checklist_items_project_id', table_name='client_checklist_items')
    op.drop_index('ix_client_checklist_items_client_id', table_name='client_checklist_items')
    op.drop_table('client_checklist_items')

    checklist_auto_signal.drop(op.get_bind(), checkfirst=True)
    checklist_item_status.drop(op.get_bind(), checkfirst=True)
    checklist_completion_mode.drop(op.get_bind(), checkfirst=True)
