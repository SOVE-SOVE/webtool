"""google review intelligence

Revision ID: b1d9f4a7c283
Revises: f2b7c1a9e3d4
Create Date: 2026-09-05 00:00:00.000000

Google Review Intelligence — a reputation snapshot computed from
whatever Google Places (New) actually gives us for a discovered
business's listing (an aggregate rating/review count, plus at most 5
individual reviews). New table `review_intelligence_results` (a sibling
to business_research_results/opportunity_score_results — same "keep
history, newest first" shape), plus four columns on
`discovered_businesses` cached from the latest result for the Review
Queue's fast list (same denormalized-read-model pattern as
opportunity_score/score_category on that table already).

Enum labels are the Python enum member names (uppercase), per this
schema's existing convention (see d5f7a3b8e912's docstring). Existing
`discovered_businesses` rows get null for all four new columns — no
review analysis has run for them yet, which is exactly what null means
here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b1d9f4a7c283'
down_revision: Union[str, None] = 'f2b7c1a9e3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


review_data_status = sa.Enum('OK', 'UNAVAILABLE', 'NO_LISTING', name='review_data_status')
review_activity_level = sa.Enum('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', name='review_activity_level')
# Used on two tables (review_intelligence_results.review_activity_level,
# discovered_businesses.review_activity_level) — same
# create-once-reference-again shape as opportunity_score_category in
# d5f7a3b8e912.
review_activity_level_existing = sa.Enum(
    'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', name='review_activity_level', create_type=False
)
review_volume_trend = sa.Enum('INCREASING', 'STABLE', 'DECLINING', 'INSUFFICIENT_DATA', name='review_volume_trend')
review_sentiment_trend = sa.Enum(
    'IMPROVING', 'STABLE', 'DECLINING', 'INSUFFICIENT_DATA', name='review_sentiment_trend'
)


def upgrade() -> None:
    op.create_table(
        'review_intelligence_results',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('discovered_business_id', sa.UUID(), nullable=False),
        sa.Column('data_status', review_data_status, nullable=False, server_default='UNAVAILABLE'),
        sa.Column('review_data_source', sa.String(length=50), nullable=False, server_default='google_places'),
        sa.Column('google_place_id', sa.String(length=500), nullable=True),
        sa.Column('google_rating', sa.Float(), nullable=True),
        sa.Column('google_review_count', sa.Integer(), nullable=True),
        sa.Column('reviews_sampled', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('reviews_with_text', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('review_activity_level', review_activity_level, nullable=False, server_default='UNKNOWN'),
        sa.Column('review_frequency_per_month', sa.Float(), nullable=True),
        sa.Column('recent_review_count', sa.Integer(), nullable=True),
        sa.Column('previous_review_count', sa.Integer(), nullable=True),
        sa.Column('last_review_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'review_volume_trend', review_volume_trend, nullable=False, server_default='INSUFFICIENT_DATA'
        ),
        sa.Column(
            'review_sentiment_trend', review_sentiment_trend, nullable=False, server_default='INSUFFICIENT_DATA'
        ),
        sa.Column('rating_distribution', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('review_health_score', sa.Integer(), nullable=True),
        sa.Column('review_health_factors', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('themes_data_sufficient', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('positive_review_themes', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('negative_review_themes', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('review_summary', sa.Text(), nullable=True),
        sa.Column('review_summary_unavailable_reason', sa.Text(), nullable=True),
        sa.Column('review_evidence', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('data_limitations', sa.Text(), nullable=True),
        sa.Column('review_data_updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['discovered_business_id'], ['discovered_businesses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_review_intelligence_results_discovered_business_id',
        'review_intelligence_results',
        ['discovered_business_id'],
    )

    op.add_column('discovered_businesses', sa.Column('google_rating', sa.Float(), nullable=True))
    op.add_column('discovered_businesses', sa.Column('google_review_count', sa.Integer(), nullable=True))
    op.add_column('discovered_businesses', sa.Column('review_health_score', sa.Integer(), nullable=True))
    op.add_column(
        'discovered_businesses', sa.Column('review_activity_level', review_activity_level_existing, nullable=True)
    )


def downgrade() -> None:
    op.drop_column('discovered_businesses', 'review_activity_level')
    op.drop_column('discovered_businesses', 'review_health_score')
    op.drop_column('discovered_businesses', 'google_review_count')
    op.drop_column('discovered_businesses', 'google_rating')

    op.drop_index('ix_review_intelligence_results_discovered_business_id', table_name='review_intelligence_results')
    op.drop_table('review_intelligence_results')

    bind = op.get_bind()
    review_sentiment_trend.drop(bind)
    review_volume_trend.drop(bind)
    review_activity_level.drop(bind)
    review_data_status.drop(bind)
