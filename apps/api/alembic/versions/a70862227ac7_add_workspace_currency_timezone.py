"""add workspace currency timezone

Revision ID: a70862227ac7
Revises: 8e47d7f4299f
Create Date: 2026-09-14 20:26:12.014927

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a70862227ac7'
down_revision: Union[str, None] = '8e47d7f4299f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'workspaces',
        sa.Column('currency', sa.String(length=3), nullable=False, server_default='AUD'),
    )
    op.add_column(
        'workspaces',
        sa.Column('timezone', sa.String(length=64), nullable=False, server_default='Australia/Brisbane'),
    )


def downgrade() -> None:
    op.drop_column('workspaces', 'timezone')
    op.drop_column('workspaces', 'currency')
