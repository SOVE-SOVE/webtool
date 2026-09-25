"""website blueprint requirements board

Adds LeadPlanningRequirement — the Website Blueprint's simplified,
position-independent "requirements board", deliberately a new table
rather than reusing LeadPlanningSitemapPage/LeadPlanningContentPage/
LeadPlanningContentSection (see that model's docstring in
modules/planning/models.py for why). The existing wireframe editor and
its data are untouched by this migration.

`ix_lead_planning_requirements_lead_planning_id` is added explicitly to
match every sibling lead_planning_* child table's own FK index (none of
them are declared via `index=True` on the model column either — this
mirrors that existing, hand-maintained convention).

Autogenerate also proposed dropping several FK-implied indexes
(`ix_lead_planning_lead_id` and similar) that pre-date this change and
are unrelated to it — left alone here, as in the previous Blueprint
migration.

Revision ID: 58b5772b1735
Revises: eb9618c4cc82
Create Date: 2026-09-24 14:37:58.863577

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '58b5772b1735'
down_revision: Union[str, None] = 'eb9618c4cc82'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lead_planning_requirements',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_planning_id', sa.UUID(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('feature_key', sa.String(length=50), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('source_recommendation_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_planning_id'], ['lead_planning.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['source_recommendation_id'], ['lead_planning_recommendations.id'], ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('lead_planning_id', 'feature_key', name='uq_lead_planning_requirement_feature'),
    )
    op.create_index(
        'ix_lead_planning_requirements_lead_planning_id',
        'lead_planning_requirements',
        ['lead_planning_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_lead_planning_requirements_lead_planning_id', table_name='lead_planning_requirements')
    op.drop_table('lead_planning_requirements')
