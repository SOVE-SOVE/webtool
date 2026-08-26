"""client portal: client_users table

Revision ID: 1e54f929d2e5
Revises: 731a8a798e83
Create Date: 2026-08-26 09:00:00.000000

Client-facing portal foundation (docs/04_ROADMAP.md). `client_users` is
a deliberately separate table from `users` — a client contact must
never be able to hold an internal-operator login. Each row is a
portal account for exactly one `clients` row (cascade-deleted with it),
with its own bcrypt password hash. See app/modules/portal/ for the
session/auth layer (own cookie, own itsdangerous salt) built on top of
this table, and docs/06_SECURITY.md for the isolation rationale.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1e54f929d2e5'
down_revision: Union[str, None] = '731a8a798e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'client_users',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('client_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['client_id'], ['clients.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email', name='uq_client_users_email'),
    )


def downgrade() -> None:
    op.drop_table('client_users')
