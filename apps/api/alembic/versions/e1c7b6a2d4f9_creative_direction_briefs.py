"""creative_direction_briefs table

Revision ID: e1c7b6a2d4f9
Revises: f6b2d8c4a190
Create Date: 2026-08-19 09:00:00.000000

Backs the Creative Director feature (roadmap M4): one row per generated
creative direction, editable in place before approval — see
docs/03_AGENT_RULES.md's "review before continuing" requirement and
apps/api/app/agents/creative_director.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e1c7b6a2d4f9'
down_revision: Union[str, None] = 'f6b2d8c4a190'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'creative_direction_briefs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM('draft', 'approved', name='creative_direction_status'),
            nullable=False,
            server_default='draft',
        ),
        sa.Column('target_audience', sa.Text(), nullable=True),
        sa.Column('business_goals', sa.Text(), nullable=True),
        sa.Column('facts', sa.Text(), nullable=False),
        sa.Column('assumptions', sa.Text(), nullable=False),
        sa.Column('creative_concept', sa.Text(), nullable=False),
        sa.Column('visual_direction', sa.Text(), nullable=False),
        sa.Column('brand_personality', sa.Text(), nullable=False),
        sa.Column('colour_direction', sa.Text(), nullable=False),
        sa.Column('typography_direction', sa.Text(), nullable=False),
        sa.Column('image_direction', sa.Text(), nullable=False),
        sa.Column('layout_direction', sa.Text(), nullable=False),
        sa.Column('ux_direction', sa.Text(), nullable=False),
        sa.Column('tone_of_voice', sa.Text(), nullable=False),
        sa.Column('visual_hierarchy', sa.Text(), nullable=False),
        sa.Column('cta_strategy', sa.Text(), nullable=False),
        sa.Column('things_to_avoid', sa.Text(), nullable=False),
        sa.Column('references_inspiration', sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(['generated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['edited_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('creative_direction_briefs')

    sa.Enum(name='creative_direction_status').drop(op.get_bind())
