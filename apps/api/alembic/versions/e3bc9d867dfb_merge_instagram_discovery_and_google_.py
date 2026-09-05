"""merge instagram discovery and google review intelligence

Revision ID: e3bc9d867dfb
Revises: b1d9f4a7c283, c75024f11eba
Create Date: 2026-09-05 19:09:44.953859

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3bc9d867dfb'
down_revision: Union[str, None] = ('b1d9f4a7c283', 'c75024f11eba')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
