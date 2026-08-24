"""outreach_channel follow_up message

Revision ID: d956f7f5fa17
Revises: b3a7c5e1f048
Create Date: 2026-08-24 00:00:00.000000

Adds FOLLOW_UP to the outreach_channel enum: a fourth outreach type,
alongside EMAIL/PHONE/IN_PERSON, drafting an actual follow-up MESSAGE
(subject/body) grounded in prior outreach — distinct from the existing
follow_ups table, which only recommends the next touch's channel/timing
and never itself takes the value "follow_up". See
apps/api/app/modules/outreach/models.py.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd956f7f5fa17'
down_revision: Union[str, None] = 'b3a7c5e1f048'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE outreach_channel ADD VALUE IF NOT EXISTS 'FOLLOW_UP'")


def downgrade() -> None:
    # Postgres can't drop a single enum value directly — rebuild the type.
    # Any outreach_messages/follow_ups row already using FOLLOW_UP would
    # fail the cast below; that's an accepted, expected downgrade hazard
    # (identical trade-off to any enum-narrowing migration), not silently
    # worked around.
    op.execute("ALTER TYPE outreach_channel RENAME TO outreach_channel_old")
    op.execute("CREATE TYPE outreach_channel AS ENUM ('EMAIL', 'PHONE', 'IN_PERSON')")
    op.execute(
        "ALTER TABLE outreach_messages ALTER COLUMN channel TYPE outreach_channel "
        "USING channel::text::outreach_channel"
    )
    op.execute(
        "ALTER TABLE follow_ups ALTER COLUMN channel TYPE outreach_channel "
        "USING channel::text::outreach_channel"
    )
    op.execute("DROP TYPE outreach_channel_old")
