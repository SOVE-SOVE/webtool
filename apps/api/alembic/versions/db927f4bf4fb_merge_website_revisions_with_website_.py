"""merge website revisions with website briefs/deployment/preview workflow branches

Revision ID: db927f4bf4fb
Revises: c7f3a9d21b04, ce37373d01d6
Create Date: 2026-08-27 08:00:52.361278

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'db927f4bf4fb'
down_revision: Union[str, None] = ('c7f3a9d21b04', 'ce37373d01d6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
