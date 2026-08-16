"""leads: status/priority/notes/archived_at; businesses: email/social_links/notes

Revision ID: 98de6f66ba7b
Revises: 7f1aabd7eb7d
Create Date: 2026-08-16 23:30:00.000000

Supersedes the pipeline-shaped `LeadStage` with a CRM-style `LeadStatus`
— see docs/05_DECISIONS.md. Existing `stage` values are best-effort
mapped onto the new statuses so no local dev data is silently dropped.

Enum labels are the Python enum *member names* (uppercase), matching
SQLAlchemy's default `Enum(PythonEnum)` behavior already used by every
other enum column in this schema (e.g. lead_stage's 'PROSPECT',
user_role's 'ADMIN') — the API still reads/writes lowercase `.value`
strings over JSON regardless of what's stored in Postgres.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '98de6f66ba7b'
down_revision: Union[str, None] = '7f1aabd7eb7d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STAGE_TO_STATUS = {
    'PROSPECT': 'NEW',
    'RESEARCH': 'RESEARCHED',
    'WEBSITE_AUDIT': 'RESEARCHED',
    'LEAD_SCORE': 'QUALIFIED',
    'SALES_PREPARATION': 'QUALIFIED',
    'OUTREACH': 'CONTACTED',
    'FOLLOW_UP': 'CONTACTED',
    'MEETING': 'MEETING',
    'WON': 'WON',
    'LOST': 'LOST',
}


def upgrade() -> None:
    lead_status = sa.Enum(
        'NEW', 'RESEARCHED', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'MEETING',
        'PROPOSAL', 'WON', 'LOST', 'NURTURE', name='lead_status',
    )
    lead_priority = sa.Enum('LOW', 'MEDIUM', 'HIGH', name='lead_priority')
    lead_status.create(op.get_bind())
    lead_priority.create(op.get_bind())

    op.add_column('leads', sa.Column('status', lead_status, nullable=True))
    connection = op.get_bind()
    for stage, status in STAGE_TO_STATUS.items():
        connection.execute(
            sa.text(
                "UPDATE leads SET status = CAST(:status AS lead_status) "
                "WHERE stage = CAST(:stage AS lead_stage)"
            ),
            {"status": status, "stage": stage},
        )
    connection.execute(
        sa.text("UPDATE leads SET status = CAST('NEW' AS lead_status) WHERE status IS NULL")
    )
    op.alter_column('leads', 'status', nullable=False, server_default='NEW')

    op.add_column(
        'leads',
        sa.Column('priority', lead_priority, nullable=False, server_default='MEDIUM'),
    )
    op.add_column('leads', sa.Column('notes', sa.Text(), nullable=True))
    op.add_column('leads', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))

    op.drop_column('leads', 'stage')
    sa.Enum(name='lead_stage').drop(op.get_bind())

    op.add_column('businesses', sa.Column('email', sa.String(length=255), nullable=True))
    op.add_column('businesses', sa.Column('social_links', sa.Text(), nullable=True))
    op.add_column('businesses', sa.Column('notes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('businesses', 'notes')
    op.drop_column('businesses', 'social_links')
    op.drop_column('businesses', 'email')

    lead_stage = sa.Enum(
        'PROSPECT', 'RESEARCH', 'WEBSITE_AUDIT', 'LEAD_SCORE', 'SALES_PREPARATION',
        'OUTREACH', 'FOLLOW_UP', 'MEETING', 'WON', 'LOST', name='lead_stage',
    )
    lead_stage.create(op.get_bind())
    op.add_column('leads', sa.Column('stage', lead_stage, nullable=True))
    connection = op.get_bind()
    status_to_stage = {v: k for k, v in reversed(list(STAGE_TO_STATUS.items()))}
    for status, stage in status_to_stage.items():
        connection.execute(
            sa.text(
                "UPDATE leads SET stage = CAST(:stage AS lead_stage) "
                "WHERE status = CAST(:status AS lead_status)"
            ),
            {"stage": stage, "status": status},
        )
    connection.execute(
        sa.text("UPDATE leads SET stage = CAST('PROSPECT' AS lead_stage) WHERE stage IS NULL")
    )
    op.alter_column('leads', 'stage', nullable=False, server_default='PROSPECT')

    op.drop_column('leads', 'archived_at')
    op.drop_column('leads', 'notes')
    op.drop_column('leads', 'priority')
    op.drop_column('leads', 'status')

    sa.Enum(name='lead_priority').drop(op.get_bind())
    sa.Enum(name='lead_status').drop(op.get_bind())
