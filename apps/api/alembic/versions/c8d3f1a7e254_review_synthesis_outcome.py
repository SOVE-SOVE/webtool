"""track the outcome of Planning's review-insights synthesis

Revision ID: c8d3f1a7e254
Revises: b7e4d2a91c35
Create Date: 2026-09-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c8d3f1a7e254'
down_revision: Union[str, None] = 'b7e4d2a91c35'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Labels are the Python enum's *names* (upper-case), like every other
# LeadPlanning enum; created once, explicitly (see ca0a45a263c8).
review_synthesis_status = postgresql.ENUM(
    'COMPLETED', 'FAILED', 'SKIPPED', name='review_synthesis_status', create_type=False
)


def upgrade() -> None:
    review_synthesis_status.create(op.get_bind(), checkfirst=True)
    # All nullable, no server default and NO backfill: there is no evidence in
    # existing rows of whether the synthesis step succeeded, so no outcome is
    # claimed. A null status on a row that already has review_insights_generated_at
    # means "previous run, outcome unknown" — not "never attempted".
    op.add_column('lead_planning', sa.Column('review_synthesis_status', review_synthesis_status, nullable=True))
    op.add_column('lead_planning', sa.Column('review_synthesis_error', sa.Text(), nullable=True))
    op.add_column('lead_planning', sa.Column('review_synthesis_attempted_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('lead_planning', sa.Column('review_synthesis_succeeded_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('lead_planning', 'review_synthesis_succeeded_at')
    op.drop_column('lead_planning', 'review_synthesis_attempted_at')
    op.drop_column('lead_planning', 'review_synthesis_error')
    op.drop_column('lead_planning', 'review_synthesis_status')
    review_synthesis_status.drop(op.get_bind(), checkfirst=True)
