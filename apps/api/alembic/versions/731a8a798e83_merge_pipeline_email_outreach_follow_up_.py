"""merge pipeline, email, outreach follow-up, and calendar migration branches

Revision ID: 731a8a798e83
Revises: a1c9e4d7f203, a7c3f9e51b26, c392b641f8cb, d956f7f5fa17
Create Date: 2026-08-26 08:25:30.641707

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '731a8a798e83'
down_revision: Union[str, None] = ('a1c9e4d7f203', 'a7c3f9e51b26', 'c392b641f8cb', 'd956f7f5fa17')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
