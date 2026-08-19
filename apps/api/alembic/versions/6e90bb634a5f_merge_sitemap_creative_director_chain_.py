"""merge sitemap/creative-director chain with project stage redesign

Revision ID: 6e90bb634a5f
Revises: b7d3f0a4c8e2, e8b2f4a91c3d
Create Date: 2026-08-19 15:50:59.795427

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6e90bb634a5f'
down_revision: Union[str, None] = ('b7d3f0a4c8e2', 'e8b2f4a91c3d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
