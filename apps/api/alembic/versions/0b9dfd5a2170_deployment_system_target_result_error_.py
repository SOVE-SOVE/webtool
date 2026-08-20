"""deployment system: target, result, error_message, started/completed_at, rollback lineage

Revision ID: 0b9dfd5a2170
Revises: 616cd61e28f9
Create Date: 2026-08-20 00:00:00.000000

Backs the real deployment system (roadmap M6): `deployments` gains
`target` (provider name), `result` (JSON detail on success),
`error_message` (populated on failure), `started_at`/`completed_at`,
and `rollback_of_deployment_id` (self-FK linking a rollback deployment
back to the successful one it re-publishes). `status` keeps its
existing column (String, not an enum) — the new "running" value is an
application-level addition, no migration needed for it. Existing rows
(all "pending", since nothing executed deployments before this) get
`target='mock'` as a safe backfill default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0b9dfd5a2170'
down_revision: Union[str, None] = '616cd61e28f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('deployments', sa.Column('target', sa.String(length=50), nullable=False, server_default='mock'))
    op.alter_column('deployments', 'target', server_default=None)
    op.add_column('deployments', sa.Column('result', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('deployments', sa.Column('error_message', sa.Text(), nullable=True))
    op.add_column('deployments', sa.Column('started_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('deployments', sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'deployments', sa.Column('rollback_of_deployment_id', postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        'deployments_rollback_of_deployment_id_fkey',
        'deployments',
        'deployments',
        ['rollback_of_deployment_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('deployments_rollback_of_deployment_id_fkey', 'deployments', type_='foreignkey')
    op.drop_column('deployments', 'rollback_of_deployment_id')
    op.drop_column('deployments', 'completed_at')
    op.drop_column('deployments', 'started_at')
    op.drop_column('deployments', 'error_message')
    op.drop_column('deployments', 'result')
    op.drop_column('deployments', 'target')
