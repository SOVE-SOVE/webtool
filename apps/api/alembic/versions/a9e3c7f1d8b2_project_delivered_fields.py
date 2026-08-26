"""project delivered_at / delivered_by_user_id

Revision ID: a9e3c7f1d8b2
Revises: f4c1a9e2b6d7
Create Date: 2026-08-26 00:10:00.000000

Phase-6-part-2 delivery workflow: `projects` gains `delivered_at`/
`delivered_by_user_id`, set only by modules/projects/service.py::
mark_delivered — the final "approve -> deploy -> monitor -> receive
URL -> verify -> deliver" step (docs/04_ROADMAP.md M6), gated on a
verified successful deployment and a completed final delivery
checklist. Existing rows get null for both; nothing here is
backfillable, since no project has ever been marked delivered before
this.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a9e3c7f1d8b2'
down_revision: Union[str, None] = 'f4c1a9e2b6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('projects', sa.Column('delivered_by_user_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'projects_delivered_by_user_id_fkey',
        'projects',
        'users',
        ['delivered_by_user_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('projects_delivered_by_user_id_fkey', 'projects', type_='foreignkey')
    op.drop_column('projects', 'delivered_by_user_id')
    op.drop_column('projects', 'delivered_at')
