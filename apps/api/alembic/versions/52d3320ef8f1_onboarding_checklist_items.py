"""client onboarding: per-project checklist items, one row per step

Revision ID: 52d3320ef8f1
Revises: 731a8a798e83
Create Date: 2026-08-26 00:00:00.000000

Client onboarding checklist covering client information, project type,
goals, target audience, services, branding, existing assets, domain,
hosting, required pages, functionality, content, deadlines, budget, and
approvals. Modeled as a child-row table per project (like `tasks`, not
a single wide row like `design_briefs`) specifically so the structure is
NOT forced to be identical across every project: any seeded item can be
marked `not_applicable` instead of done, and an operator can add
project-specific items (`is_custom=True`) on top of the starter set. A
seeded (non-custom) item is never deleted — only a custom one can be —
so the checklist always shows the full set of areas an onboarding could
cover even when several don't apply to a given project.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '52d3320ef8f1'
down_revision: Union[str, None] = '731a8a798e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    category = sa.Enum(
        'CLIENT_INFORMATION', 'PROJECT_TYPE', 'GOALS', 'TARGET_AUDIENCE', 'SERVICES', 'BRANDING',
        'EXISTING_ASSETS', 'DOMAIN', 'HOSTING', 'REQUIRED_PAGES', 'FUNCTIONALITY', 'CONTENT',
        'DEADLINES', 'BUDGET', 'APPROVALS', name='onboarding_category',
    )
    category.create(op.get_bind())
    category_column_type = postgresql.ENUM(
        'CLIENT_INFORMATION', 'PROJECT_TYPE', 'GOALS', 'TARGET_AUDIENCE', 'SERVICES', 'BRANDING',
        'EXISTING_ASSETS', 'DOMAIN', 'HOSTING', 'REQUIRED_PAGES', 'FUNCTIONALITY', 'CONTENT',
        'DEADLINES', 'BUDGET', 'APPROVALS', name='onboarding_category', create_type=False,
    )

    item_status = sa.Enum('PENDING', 'DONE', 'NOT_APPLICABLE', name='onboarding_item_status')
    item_status.create(op.get_bind())
    item_status_column_type = postgresql.ENUM(
        'PENDING', 'DONE', 'NOT_APPLICABLE', name='onboarding_item_status', create_type=False
    )

    op.create_table(
        'onboarding_checklist_items',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('category', category_column_type, nullable=False),
        sa.Column('label', sa.String(length=255), nullable=False),
        sa.Column('status', item_status_column_type, nullable=False, server_default='PENDING'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_custom', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_onboarding_checklist_items_project_id', 'onboarding_checklist_items', ['project_id']
    )


def downgrade() -> None:
    op.drop_index('ix_onboarding_checklist_items_project_id', table_name='onboarding_checklist_items')
    op.drop_table('onboarding_checklist_items')
    sa.Enum(name='onboarding_item_status').drop(op.get_bind())
    sa.Enum(name='onboarding_category').drop(op.get_bind())
