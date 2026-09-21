"""merge planning handoff sync and review synthesis outcome

Revision ID: e7fa84436c8d
Revises: c4a8e1f7b3d2, c8d3f1a7e254
Create Date: 2026-09-21 15:45:22.208325

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7fa84436c8d'
down_revision: Union[str, None] = ('c4a8e1f7b3d2', 'c8d3f1a7e254')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
