"""website_briefs table

Revision ID: 9c1f5a7e3d62
Revises: 731a8a798e83
Create Date: 2026-08-26 10:00:00.000000

Backs the Website Brief generator (roadmap M4): one row per generated
brief, editable in place before approval — see docs/03_AGENT_RULES.md's
"review before continuing" requirement and
apps/api/app/agents/website_brief.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '9c1f5a7e3d62'
down_revision: Union[str, None] = '731a8a798e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'website_briefs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM('DRAFT', 'APPROVED', name='website_brief_status'),
            nullable=False,
            server_default='DRAFT',
        ),
        sa.Column('creative_direction_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('sitemap_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('project_summary', sa.Text(), nullable=False),
        sa.Column('goals', sa.Text(), nullable=False),
        sa.Column('target_audience', sa.Text(), nullable=False),
        sa.Column('positioning', sa.Text(), nullable=False),
        sa.Column('sitemap_summary', sa.Text(), nullable=False),
        sa.Column('page_purposes', sa.Text(), nullable=False),
        sa.Column('content_requirements', sa.Text(), nullable=False),
        sa.Column('cta_strategy', sa.Text(), nullable=False),
        sa.Column('visual_direction', sa.Text(), nullable=False),
        sa.Column('functionality', sa.Text(), nullable=False),
        sa.Column('seo_considerations', sa.Text(), nullable=False),
        sa.Column('technical_requirements', sa.Text(), nullable=False),
        sa.Column('confirmed_requirements', sa.Text(), nullable=False),
        sa.Column('ai_suggestions', sa.Text(), nullable=False),
        sa.Column('sources_note', sa.Text(), nullable=True),
        sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('model_used', sa.String(length=100), nullable=False),
        sa.Column('prompt_version', sa.String(length=50), nullable=False),
        sa.Column('generated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('edited_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('approved_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['creative_direction_id'], ['creative_direction_briefs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['sitemap_id'], ['sitemaps.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['generated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['edited_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('website_briefs')

    sa.Enum(name='website_brief_status').drop(op.get_bind())
