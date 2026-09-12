"""planning: New Website Plan mode + comparable-site research

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-09-14 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Labels are the Python enum's *names* (upper-case) — see
# a1b2c3d4e5f6's comment on why: SQLAlchemy's Enum type binds/reads by
# member name by default for a str-mixin Python enum, matching this
# repo's existing planning_status convention.
comparable_research_status = sa.Enum(
    'READY_FOR_REVIEW', 'ANALYSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED',
    name='comparable_research_status',
)


def upgrade() -> None:
    # "New Website Plan" mode fields — see LeadPlanning's docstring.
    op.add_column('lead_planning', sa.Column('recommended_objective', sa.Text(), nullable=True))
    op.add_column(
        'lead_planning',
        sa.Column('priority_pages', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column(
        'lead_planning',
        sa.Column('content_priorities', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column(
        'lead_planning',
        sa.Column('contact_priorities', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column(
        'lead_planning',
        sa.Column('visual_priorities', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column(
        'lead_planning',
        sa.Column('open_questions', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column('lead_planning', sa.Column('website_plan_generated_at', sa.DateTime(timezone=True), nullable=True))

    # "Research Comparable Websites" — synthesis + status on the parent row.
    comparable_research_status.create(op.get_bind(), checkfirst=True)
    op.add_column('lead_planning', sa.Column('comparable_research_status', comparable_research_status, nullable=True))
    op.add_column('lead_planning', sa.Column('comparable_research_error', sa.Text(), nullable=True))
    op.add_column(
        'lead_planning',
        sa.Column(
            'comparable_research_patterns', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'
        ),
    )
    op.add_column(
        'lead_planning',
        sa.Column(
            'comparable_research_opportunities',
            postgresql.JSON(astext_type=sa.Text()),
            nullable=False,
            server_default='[]',
        ),
    )
    op.add_column(
        'lead_planning', sa.Column('comparable_research_generated_at', sa.DateTime(timezone=True), nullable=True)
    )

    # Candidate reference sites — deliberately its own table, never
    # discovered_businesses (see LeadPlanningComparableSite's docstring).
    op.create_table(
        'lead_planning_comparable_sites',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_planning_id', sa.UUID(), nullable=False),
        sa.Column('business_name', sa.String(length=255), nullable=False),
        sa.Column('website_url', sa.String(length=500), nullable=False),
        sa.Column('business_category', sa.String(length=120), nullable=True),
        sa.Column('location_text', sa.String(length=255), nullable=True),
        sa.Column('source_provider', sa.String(length=50), nullable=False),
        sa.Column('source_evidence', sa.Text(), nullable=True),
        sa.Column('included', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('fetch_ok', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_planning_id'], ['lead_planning.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_lead_planning_comparable_sites_lead_planning_id',
        'lead_planning_comparable_sites',
        ['lead_planning_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_lead_planning_comparable_sites_lead_planning_id', table_name='lead_planning_comparable_sites')
    op.drop_table('lead_planning_comparable_sites')

    op.drop_column('lead_planning', 'comparable_research_generated_at')
    op.drop_column('lead_planning', 'comparable_research_opportunities')
    op.drop_column('lead_planning', 'comparable_research_patterns')
    op.drop_column('lead_planning', 'comparable_research_error')
    op.drop_column('lead_planning', 'comparable_research_status')
    comparable_research_status.drop(op.get_bind(), checkfirst=True)

    op.drop_column('lead_planning', 'website_plan_generated_at')
    op.drop_column('lead_planning', 'open_questions')
    op.drop_column('lead_planning', 'visual_priorities')
    op.drop_column('lead_planning', 'contact_priorities')
    op.drop_column('lead_planning', 'content_priorities')
    op.drop_column('lead_planning', 'priority_pages')
    op.drop_column('lead_planning', 'recommended_objective')
