"""discovered_businesses: map coordinates

Revision ID: c4d8f2a6e0b1
Revises: b3c7e1d9a2f4
Create Date: 2026-08-31 16:00:00.000000

Optional latitude/longitude for the Lead Discovery map. Only ever holds
a value a source actually provided (a places provider's coordinates, or
GeoCoordinates a site publishes in its own schema.org markup) — never
geocoded from a name or a city. Existing rows: null (no reliable
location), so no pin.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4d8f2a6e0b1"
down_revision: Union[str, None] = "b3c7e1d9a2f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("discovered_businesses", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("discovered_businesses", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("discovered_businesses", "longitude")
    op.drop_column("discovered_businesses", "latitude")
