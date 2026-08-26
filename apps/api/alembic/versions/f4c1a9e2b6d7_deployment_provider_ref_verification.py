"""deployment provider_ref and verification fields

Revision ID: f4c1a9e2b6d7
Revises: 731a8a798e83
Create Date: 2026-08-26 00:00:00.000000

Phase-6-part-2 deployment adapter architecture: `deployments` gains
`provider_ref` (a real provider's own id for the deployment, e.g. a
Vercel/Netlify deployment id — round-tripped into the new `get_status`/
`rollback` provider methods, see app/integrations/deployment/base.py)
and `verified_at`/`verified_by_user_id` (the separate "verify
deployment" handover step — modules/deployments/service.py::
verify_deployment — that a project's delivery now requires before it
can be marked delivered, see modules/projects/service.py::
mark_delivered). Existing rows simply get null for all three; nothing
here is backfillable, since no real provider has ever run and no
deployment has ever been verified before this.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f4c1a9e2b6d7'
down_revision: Union[str, None] = '731a8a798e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('deployments', sa.Column('provider_ref', sa.String(length=255), nullable=True))
    op.add_column('deployments', sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('deployments', sa.Column('verified_by_user_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'deployments_verified_by_user_id_fkey',
        'deployments',
        'users',
        ['verified_by_user_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('deployments_verified_by_user_id_fkey', 'deployments', type_='foreignkey')
    op.drop_column('deployments', 'verified_by_user_id')
    op.drop_column('deployments', 'verified_at')
    op.drop_column('deployments', 'provider_ref')
