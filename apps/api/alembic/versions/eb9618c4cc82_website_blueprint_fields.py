"""website blueprint fields

Adds the Website Blueprint's own light, additive fields on top of the
existing Planning sitemap/content hierarchy (LeadPlanningSitemapPage ->
LeadPlanningContentPage -> LeadPlanningContentSection) — no new tables,
since the Blueprint reuses that hierarchy rather than duplicating it
(see modules/planning/models.py's LeadPlanningContentSection docstring
and service.apply_blueprint_template).

Autogenerate also proposed dropping several FK-implied indexes
(`ix_lead_planning_lead_id` and similar) that pre-date this change and
are unrelated to it — left alone here; not this migration's concern.

Revision ID: eb9618c4cc82
Revises: e7fa84436c8d
Create Date: 2026-09-23 16:25:30.301523

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'eb9618c4cc82'
down_revision: Union[str, None] = 'e7fa84436c8d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('lead_planning', sa.Column('blueprint_template', sa.String(length=20), nullable=True))
    op.add_column('lead_planning', sa.Column('blueprint_selected_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('lead_planning_content_sections', sa.Column('heading', sa.String(length=255), nullable=True))
    op.add_column('lead_planning_content_sections', sa.Column('purpose', sa.Text(), nullable=True))
    op.add_column('lead_planning_content_sections', sa.Column('draft_text', sa.Text(), nullable=True))
    op.add_column('lead_planning_content_sections', sa.Column('notes', sa.Text(), nullable=True))
    op.add_column('lead_planning_content_sections', sa.Column('source_recommendation_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_lead_planning_content_sections_source_recommendation_id',
        'lead_planning_content_sections',
        'lead_planning_recommendations',
        ['source_recommendation_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint(
        'fk_lead_planning_content_sections_source_recommendation_id',
        'lead_planning_content_sections',
        type_='foreignkey',
    )
    op.drop_column('lead_planning_content_sections', 'source_recommendation_id')
    op.drop_column('lead_planning_content_sections', 'notes')
    op.drop_column('lead_planning_content_sections', 'draft_text')
    op.drop_column('lead_planning_content_sections', 'purpose')
    op.drop_column('lead_planning_content_sections', 'heading')
    op.drop_column('lead_planning', 'blueprint_selected_at')
    op.drop_column('lead_planning', 'blueprint_template')
