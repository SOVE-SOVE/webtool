"""content_drafts table

Revision ID: c8f1a5e93d07
Revises: 731a8a798e83
Create Date: 2026-08-26 10:00:00.000000

Backs the AI website content generation system (roadmap M4's "Copy
drafts generated from intake + research, for operator sign-off before
build"): one row per generation, newest reviewed first, same convention
as Sitemap/CreativeDirectionBrief/Website — see
apps/api/app/agents/content_generator.py and
apps/api/app/modules/content_drafts/.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c8f1a5e93d07'
down_revision: Union[str, None] = '731a8a798e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'content_drafts',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM('DRAFT', 'APPROVED', name='content_draft_status'),
            nullable=False,
            server_default='DRAFT',
        ),
        sa.Column('tone', sa.String(length=30), nullable=False),
        sa.Column('sitemap_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('creative_direction_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('config', sa.JSON(), nullable=True),
        sa.Column('missing_information', sa.Text(), nullable=True),
        sa.Column('rolled_back_from_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('sources_note', sa.Text(), nullable=True),
        sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('model_used', sa.String(length=100), nullable=True),
        sa.Column('prompt_version', sa.String(length=50), nullable=True),
        sa.Column('generated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('approved_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sitemap_id'], ['sitemaps.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['creative_direction_id'], ['creative_direction_briefs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['rolled_back_from_id'], ['content_drafts.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['generated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('content_drafts')

    sa.Enum(name='content_draft_status').drop(op.get_bind())
