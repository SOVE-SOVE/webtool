"""stage checklists

Revision ID: f3c7a91b2d40
Revises: a8f9da92d242
Create Date: 2026-09-13 19:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f3c7a91b2d40'
down_revision: Union[str, None] = 'a8f9da92d242'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# checklist_completion_mode / checklist_item_status already exist (created
# by 32118c81e86f_client_checklist) and are reused as-is by
# StageChecklistItem — create_type=False for both, same "created once,
# never implicitly re-created by create_table" convention this codebase
# already follows. stage_checklist_auto_signal is new to this migration.
checklist_completion_mode = postgresql.ENUM(
    'AUTOMATIC', 'MANUAL', name='checklist_completion_mode', create_type=False
)
checklist_item_status = postgresql.ENUM(
    'PENDING', 'COMPLETE', 'NOT_REQUIRED', name='checklist_item_status', create_type=False
)
stage_checklist_auto_signal = postgresql.ENUM(
    'DISCOVERY_SITE_REVIEW',
    'DISCOVERY_SCORE',
    'LEAD_RESEARCH',
    'PLANNING_AUDIT',
    'PLANNING_REVIEW_INSIGHTS',
    'PLANNING_RECOMMENDATIONS',
    'PLANNING_STRUCTURE',
    'PLANNING_ASSETS',
    'PLANNING_BUILD_BRIEF_APPROVED',
    'PROJECT_PREVIEW_BUILT',
    'PROJECT_QA_COMPLETE',
    'PROJECT_LAUNCH_APPROVED',
    name='stage_checklist_auto_signal',
    create_type=False,
)


def upgrade() -> None:
    stage_checklist_auto_signal.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'stage_checklist_items',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('discovered_business_id', sa.UUID(), nullable=True),
        sa.Column('lead_id', sa.UUID(), nullable=True),
        sa.Column('lead_planning_id', sa.UUID(), nullable=True),
        sa.Column('project_id', sa.UUID(), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('completion_mode', checklist_completion_mode, nullable=False, server_default='MANUAL'),
        sa.Column('auto_signal', stage_checklist_auto_signal, nullable=True),
        sa.Column('status', checklist_item_status, nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_by_user_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['discovered_business_id'], ['discovered_businesses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['lead_planning_id'], ['lead_planning.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['completed_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            'num_nonnulls(discovered_business_id, lead_id, lead_planning_id, project_id) = 1',
            name='ck_stage_checklist_item_exactly_one_owner',
        ),
    )
    op.create_index('ix_stage_checklist_items_discovered_business_id', 'stage_checklist_items', ['discovered_business_id'])
    op.create_index('ix_stage_checklist_items_lead_id', 'stage_checklist_items', ['lead_id'])
    op.create_index('ix_stage_checklist_items_lead_planning_id', 'stage_checklist_items', ['lead_planning_id'])
    op.create_index('ix_stage_checklist_items_project_id', 'stage_checklist_items', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_stage_checklist_items_project_id', table_name='stage_checklist_items')
    op.drop_index('ix_stage_checklist_items_lead_planning_id', table_name='stage_checklist_items')
    op.drop_index('ix_stage_checklist_items_lead_id', table_name='stage_checklist_items')
    op.drop_index('ix_stage_checklist_items_discovered_business_id', table_name='stage_checklist_items')
    op.drop_table('stage_checklist_items')

    stage_checklist_auto_signal.drop(op.get_bind(), checkfirst=True)
