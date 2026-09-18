"""discovered_businesses: explicit review-queue membership

Revision ID: a1c3e8f0d2b4
Revises: 7d7fce74afb1
Create Date: 2026-09-18 12:00:00.000000

Adds `review_queued_at` — explicit, opt-in Review Queue membership,
separate from `status`, so the Discovery workspace's Review Queue tab
can show only businesses an operator deliberately added there instead
of every discovered business automatically (docs/05_DECISIONS.md
"Combine Map Discovery and Review Queue"). Backfills every existing row
to its own `discovered_at` so nothing already sitting in review/
approved/rejected/imported/archived silently disappears from view —
only businesses discovered *after* this migration start out unqueued
and need an explicit "Add to Review Queue" action.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c3e8f0d2b4'
down_revision: Union[str, None] = '7d7fce74afb1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('discovered_businesses', sa.Column('review_queued_at', sa.DateTime(timezone=True), nullable=True))
    op.execute('UPDATE discovered_businesses SET review_queued_at = discovered_at')


def downgrade() -> None:
    op.drop_column('discovered_businesses', 'review_queued_at')
