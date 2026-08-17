"""meetings: project/lead dual-parent, drop sales_opportunity_id, add title

Revision ID: c2f4a8d1e6b7
Revises: 48b1c35a140b
Create Date: 2026-08-18 09:15:00.000000

Backs the Calendar + Client Management feature. `meetings` was schema-only
scaffolding with zero routes/service and zero rows since the initial
migration — this is a clean shape change, not a data migration. See
docs/05_DECISIONS.md for why Meeting now belongs to a project or a lead
(mirroring Task's dual-parent pattern) instead of a sales_opportunity as
originally documented: sales_opportunities has no CRUD surface anywhere
in the app, so meetings would have had nothing to attach to on the UI
side.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c2f4a8d1e6b7'
down_revision: Union[str, None] = '48b1c35a140b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('meetings_sales_opportunity_id_fkey', 'meetings', type_='foreignkey')
    op.drop_column('meetings', 'sales_opportunity_id')

    op.add_column('meetings', sa.Column('title', sa.String(length=255), nullable=False, server_default='Meeting'))
    op.alter_column('meetings', 'title', server_default=None)

    op.add_column('meetings', sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('meetings', sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'meetings_project_id_fkey', 'meetings', 'projects', ['project_id'], ['id'], ondelete='CASCADE'
    )
    op.create_foreign_key(
        'meetings_lead_id_fkey', 'meetings', 'leads', ['lead_id'], ['id'], ondelete='CASCADE'
    )
    op.create_check_constraint(
        'meeting_belongs_to_exactly_one_parent',
        'meetings',
        '(project_id IS NOT NULL)::int + (lead_id IS NOT NULL)::int = 1',
    )

    op.alter_column('meetings', 'scheduled_at', nullable=False)


def downgrade() -> None:
    op.alter_column('meetings', 'scheduled_at', nullable=True)

    op.drop_constraint('meeting_belongs_to_exactly_one_parent', 'meetings', type_='check')
    op.drop_constraint('meetings_lead_id_fkey', 'meetings', type_='foreignkey')
    op.drop_constraint('meetings_project_id_fkey', 'meetings', type_='foreignkey')
    op.drop_column('meetings', 'lead_id')
    op.drop_column('meetings', 'project_id')
    op.drop_column('meetings', 'title')

    op.add_column('meetings', sa.Column('sales_opportunity_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'meetings_sales_opportunity_id_fkey',
        'meetings',
        'sales_opportunities',
        ['sales_opportunity_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.alter_column('meetings', 'sales_opportunity_id', nullable=False)
