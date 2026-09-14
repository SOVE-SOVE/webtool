"""merge planning new-website-plan-mode and ai_usage_events branches

Revision ID: e072ab2883c5
Revises: b2c3d4e5f6a7, f9b5ad0ab10f
Create Date: 2026-09-12 22:17:49.156091

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e072ab2883c5'
down_revision: Union[str, None] = ('b2c3d4e5f6a7', 'f9b5ad0ab10f')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
