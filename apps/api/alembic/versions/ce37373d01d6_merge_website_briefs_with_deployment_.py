"""merge website briefs with deployment/preview workflow branches

Revision ID: ce37373d01d6
Revises: 9c1f5a7e3d62, b2d6f8e4c1a3
Create Date: 2026-08-27 07:39:34.517435

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ce37373d01d6'
down_revision: Union[str, None] = ('9c1f5a7e3d62', 'b2d6f8e4c1a3')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
