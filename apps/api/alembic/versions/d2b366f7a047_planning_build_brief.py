"""planning build brief

Revision ID: d2b366f7a047
Revises: bfc429d81d78
Create Date: 2026-09-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd2b366f7a047'
down_revision: Union[str, None] = 'bfc429d81d78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Labels are the Python enum's *names* (upper-case) — same convention as
# every other LeadPlanning enum (planning_status, social_data_source, ...):
# SQLAlchemy's Enum type binds/reads by member name by default for a
# str-mixin Python enum.
#
# create_type=False on every one of these: each type is created exactly
# once via its own explicit .create() call below, not implicitly by
# create_table's column-type visitor — passing both would (and did, in
# testing) issue CREATE TYPE twice in the same transaction and fail.
recommendation_category = postgresql.ENUM('KEEP', 'IMPROVE', 'ADD', name='recommendation_category', create_type=False)
recommendation_source_type = postgresql.ENUM(
    'AUDIT_FINDING', 'REVIEW_THEME', 'SOCIAL_PRESENCE', 'BUSINESS_INFO', 'COMPARABLE_RESEARCH', 'OPERATOR',
    name='recommendation_source_type', create_type=False,
)
recommendation_status = postgresql.ENUM(
    'PROPOSED', 'ACCEPTED', 'DISMISSED', name='recommendation_status', create_type=False
)
asset_status = postgresql.ENUM(
    'READY_TO_USE', 'REFERENCE_ONLY', 'NEEDS_OWNER_APPROVAL', 'MISSING', name='asset_status', create_type=False
)

# sitemap_page_type already exists (created by modules/sitemaps' own
# migration) — reused as-is, never re-created here.
sitemap_page_type = postgresql.ENUM(name='sitemap_page_type', create_type=False)


def upgrade() -> None:
    recommendation_category.create(op.get_bind(), checkfirst=True)
    recommendation_source_type.create(op.get_bind(), checkfirst=True)
    recommendation_status.create(op.get_bind(), checkfirst=True)
    asset_status.create(op.get_bind(), checkfirst=True)

    # LeadPlanning: Build Brief bookkeeping columns.
    op.add_column('lead_planning', sa.Column('recommendations_objective', sa.Text(), nullable=True))
    op.add_column('lead_planning', sa.Column('recommendations_generated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('lead_planning', sa.Column('sitemap_proposal_generated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'lead_planning',
        sa.Column('visual_direction_options', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column(
        'lead_planning',
        sa.Column('selected_visual_direction', postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )
    op.add_column('lead_planning', sa.Column('visual_directions_generated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('lead_planning', sa.Column('assets_checklist_generated_at', sa.DateTime(timezone=True), nullable=True))

    # Keep / Improve / Add.
    op.create_table(
        'lead_planning_recommendations',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_planning_id', sa.UUID(), nullable=False),
        sa.Column('category', recommendation_category, nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('explanation', sa.Text(), nullable=False),
        sa.Column('source_type', recommendation_source_type, nullable=False),
        sa.Column('source_evidence', sa.Text(), nullable=True),
        sa.Column('status', recommendation_status, nullable=False, server_default='PROPOSED'),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_planning_id'], ['lead_planning.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_lead_planning_recommendations_lead_planning_id', 'lead_planning_recommendations', ['lead_planning_id']
    )

    # Proposed Sitemap and Homepage Outline.
    op.create_table(
        'lead_planning_sitemap_pages',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_planning_id', sa.UUID(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('page_type', sitemap_page_type, nullable=False),
        sa.Column('purpose', sa.Text(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('key_sections', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('needs_confirmation', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_planning_id'], ['lead_planning.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_lead_planning_sitemap_pages_lead_planning_id', 'lead_planning_sitemap_pages', ['lead_planning_id']
    )

    # Assets Checklist.
    op.create_table(
        'lead_planning_assets',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_planning_id', sa.UUID(), nullable=False),
        sa.Column('category', sa.String(length=50), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=False),
        sa.Column('status', asset_status, nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_planning_id'], ['lead_planning.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_lead_planning_assets_lead_planning_id', 'lead_planning_assets', ['lead_planning_id'])

    # Approved Build Brief snapshot.
    op.create_table(
        'lead_planning_approved_briefs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_planning_id', sa.UUID(), nullable=False),
        sa.Column('objective', sa.Text(), nullable=False),
        sa.Column('confirmed_facts', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('accepted_recommendations', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('sitemap_snapshot', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('visual_direction_snapshot', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('content_priorities', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('contact_priorities', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('visual_priorities', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('assets_snapshot', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('open_questions_snapshot', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('approved_by_user_id', sa.UUID(), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_planning_id'], ['lead_planning.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('lead_planning_id'),
    )


def downgrade() -> None:
    op.drop_table('lead_planning_approved_briefs')

    op.drop_index('ix_lead_planning_assets_lead_planning_id', table_name='lead_planning_assets')
    op.drop_table('lead_planning_assets')

    op.drop_index('ix_lead_planning_sitemap_pages_lead_planning_id', table_name='lead_planning_sitemap_pages')
    op.drop_table('lead_planning_sitemap_pages')

    op.drop_index('ix_lead_planning_recommendations_lead_planning_id', table_name='lead_planning_recommendations')
    op.drop_table('lead_planning_recommendations')

    op.drop_column('lead_planning', 'assets_checklist_generated_at')
    op.drop_column('lead_planning', 'visual_directions_generated_at')
    op.drop_column('lead_planning', 'selected_visual_direction')
    op.drop_column('lead_planning', 'visual_direction_options')
    op.drop_column('lead_planning', 'sitemap_proposal_generated_at')
    op.drop_column('lead_planning', 'recommendations_generated_at')
    op.drop_column('lead_planning', 'recommendations_objective')

    asset_status.drop(op.get_bind(), checkfirst=True)
    recommendation_status.drop(op.get_bind(), checkfirst=True)
    recommendation_source_type.drop(op.get_bind(), checkfirst=True)
    recommendation_category.drop(op.get_bind(), checkfirst=True)
