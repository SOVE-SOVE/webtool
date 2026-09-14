"""planning social presence fields

Revision ID: bfc429d81d78
Revises: e072ab2883c5
Create Date: 2026-09-12 22:18:22.564354

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bfc429d81d78'
down_revision: Union[str, None] = 'e072ab2883c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Labels are the Python enum's *names* (upper-case) — same convention as
# planning_status/comparable_research_status: SQLAlchemy's Enum type
# binds/reads by member name by default for a str-mixin Python enum.
social_data_source = sa.Enum(
    'DISCOVERED_BUSINESS', 'OPERATOR_ENTERED', 'META_ENRICHMENT',
    name='social_data_source',
)


def upgrade() -> None:
    social_data_source.create(op.get_bind(), checkfirst=True)

    op.add_column('lead_planning', sa.Column('instagram_handle', sa.String(length=100), nullable=True))
    op.add_column('lead_planning', sa.Column('instagram_profile_url', sa.String(length=500), nullable=True))
    op.add_column('lead_planning', sa.Column('instagram_bio', sa.Text(), nullable=True))
    op.add_column('lead_planning', sa.Column('instagram_bio_link_url', sa.String(length=500), nullable=True))
    op.add_column('lead_planning', sa.Column('instagram_source', social_data_source, nullable=True))
    op.add_column('lead_planning', sa.Column('instagram_verified_at', sa.DateTime(timezone=True), nullable=True))

    op.add_column('lead_planning', sa.Column('facebook_page_url', sa.String(length=500), nullable=True))
    op.add_column('lead_planning', sa.Column('facebook_page_name', sa.String(length=255), nullable=True))
    op.add_column('lead_planning', sa.Column('facebook_bio', sa.Text(), nullable=True))
    op.add_column('lead_planning', sa.Column('facebook_source', social_data_source, nullable=True))
    op.add_column('lead_planning', sa.Column('facebook_verified_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('lead_planning', 'facebook_verified_at')
    op.drop_column('lead_planning', 'facebook_source')
    op.drop_column('lead_planning', 'facebook_bio')
    op.drop_column('lead_planning', 'facebook_page_name')
    op.drop_column('lead_planning', 'facebook_page_url')

    op.drop_column('lead_planning', 'instagram_verified_at')
    op.drop_column('lead_planning', 'instagram_source')
    op.drop_column('lead_planning', 'instagram_bio_link_url')
    op.drop_column('lead_planning', 'instagram_bio')
    op.drop_column('lead_planning', 'instagram_profile_url')
    op.drop_column('lead_planning', 'instagram_handle')

    social_data_source.drop(op.get_bind(), checkfirst=True)
