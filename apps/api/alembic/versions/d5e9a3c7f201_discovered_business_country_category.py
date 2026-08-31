"""discovered_businesses: country + business_category

Revision ID: d5e9a3c7f201
Revises: c4d8f2a6e0b1
Create Date: 2026-08-31 18:30:00.000000

Two more optional structured fields for a discovered business:
`country` (rounds out address/suburb/state/postcode) and
`business_category` (a specific provider-assigned category, finer than
`industry`). Both nullable — existing rows stay valid with null.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5e9a3c7f201"
down_revision: Union[str, None] = "c4d8f2a6e0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("discovered_businesses", sa.Column("country", sa.String(length=80), nullable=True))
    op.add_column(
        "discovered_businesses", sa.Column("business_category", sa.String(length=120), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("discovered_businesses", "business_category")
    op.drop_column("discovered_businesses", "country")
