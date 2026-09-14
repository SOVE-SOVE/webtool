"""checklist task ownership, blocked state, required/optional

Revision ID: b7c2e94a1f6d
Revises: f3c7a91b2d40
Create Date: 2026-09-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c2e94a1f6d'
down_revision: Union[str, None] = 'f3c7a91b2d40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # checklist_item_status is shared by client_checklist_items and
    # stage_checklist_items — one ALTER TYPE gives both tables the new
    # value. Only adds the value here; no row in this same migration
    # uses it, so this is safe inside Postgres 12+'s normal transactional
    # DDL (the restriction is only on using a brand-new value in the same
    # transaction that added it).
    op.execute("ALTER TYPE checklist_item_status ADD VALUE IF NOT EXISTS 'BLOCKED'")

    for table in ("client_checklist_items", "stage_checklist_items"):
        op.add_column(table, sa.Column('assigned_user_id', sa.UUID(), nullable=True))
        op.add_column(table, sa.Column('blocked_reason', sa.String(length=500), nullable=True))
        op.add_column(table, sa.Column('is_required', sa.Boolean(), nullable=False, server_default=sa.true()))
        op.create_foreign_key(
            f'{table}_assigned_user_id_fkey', table, 'users', ['assigned_user_id'], ['id'], ondelete='SET NULL'
        )


def downgrade() -> None:
    for table in ("client_checklist_items", "stage_checklist_items"):
        op.drop_constraint(f'{table}_assigned_user_id_fkey', table, type_='foreignkey')
        op.drop_column(table, 'is_required')
        op.drop_column(table, 'blocked_reason')
        op.drop_column(table, 'assigned_user_id')

    # Postgres has no ALTER TYPE ... DROP VALUE — removing 'BLOCKED' from
    # checklist_item_status would require rebuilding the type and every
    # dependent column. Left as a no-op; the extra enum label is harmless
    # if this migration is ever rolled back.
