"""merge heads (checklist ownership + ai usage events/planning)

Revision ID: 8e47d7f4299f
Revises: 51dce8344446, b7c2e94a1f6d
Create Date: 2026-09-14 10:57:05.519100

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8e47d7f4299f'
down_revision: Union[str, None] = ('51dce8344446', 'b7c2e94a1f6d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
