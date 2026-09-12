"""add lead-scoped review intelligence and planning review insights

Revision ID: fe3c2ead557c
Revises: d8f3a6c2e719
Create Date: 2026-09-10 22:25:18.466686

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'fe3c2ead557c'
down_revision: Union[str, None] = 'd8f3a6c2e719'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # "Google Review Insights" (docs/05_DECISIONS.md) — lets Planning
    # run the existing review_intelligence pipeline for a Lead directly
    # (rather than only via a DiscoveredBusiness), and stores this
    # workspace's own synthesis of that data.
    op.add_column('review_intelligence_results', sa.Column('lead_id', sa.UUID(), nullable=True))
    op.alter_column('review_intelligence_results', 'discovered_business_id',
               existing_type=sa.UUID(),
               nullable=True)
    op.create_foreign_key(
        'fk_review_intelligence_results_lead_id_leads', 'review_intelligence_results', 'leads', ['lead_id'], ['id'], ondelete='CASCADE'
    )
    op.create_check_constraint(
        'ck_review_intelligence_discovered_business_xor_lead',
        'review_intelligence_results',
        '(discovered_business_id IS NOT NULL) != (lead_id IS NOT NULL)',
    )

    op.add_column('lead_planning', sa.Column('review_intelligence_id', sa.UUID(), nullable=True))
    op.add_column('lead_planning', sa.Column('review_summary', sa.Text(), nullable=True))
    op.add_column(
        'lead_planning',
        sa.Column('review_website_opportunities', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column(
        'lead_planning',
        sa.Column('review_faq_opportunities', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column(
        'lead_planning',
        sa.Column('review_website_gaps', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column('lead_planning', sa.Column('review_insights_generated_at', sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        'fk_lead_planning_review_intelligence_id', 'lead_planning', 'review_intelligence_results',
        ['review_intelligence_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('fk_lead_planning_review_intelligence_id', 'lead_planning', type_='foreignkey')
    op.drop_column('lead_planning', 'review_insights_generated_at')
    op.drop_column('lead_planning', 'review_website_gaps')
    op.drop_column('lead_planning', 'review_faq_opportunities')
    op.drop_column('lead_planning', 'review_website_opportunities')
    op.drop_column('lead_planning', 'review_summary')
    op.drop_column('lead_planning', 'review_intelligence_id')

    op.drop_constraint('ck_review_intelligence_discovered_business_xor_lead', 'review_intelligence_results', type_='checkconstraint')
    op.drop_constraint('fk_review_intelligence_results_lead_id_leads', 'review_intelligence_results', type_='foreignkey')
    op.alter_column('review_intelligence_results', 'discovered_business_id',
               existing_type=sa.UUID(),
               nullable=False)
    op.drop_column('review_intelligence_results', 'lead_id')
