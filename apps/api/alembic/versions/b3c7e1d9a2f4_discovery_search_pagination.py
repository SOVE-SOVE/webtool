"""discovery_searches: pagination bookkeeping

Revision ID: b3c7e1d9a2f4
Revises: a1b2c9d3e4f5
Create Date: 2026-08-31 14:00:00.000000

A discovery search grows in place as "load more" pulls further provider
pages. `next_offset` is the provider page offset the next pull would
use; `has_more` is whether the provider said further results exist.
Existing rows: offset 0, nothing more to load (their run is done).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3c7e1d9a2f4"
down_revision: Union[str, None] = "a1b2c9d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "discovery_searches",
        sa.Column("next_offset", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "discovery_searches",
        sa.Column("has_more", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("discovery_searches", "has_more")
    op.drop_column("discovery_searches", "next_offset")
