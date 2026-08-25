"""sales pipeline: configurable per-workspace stage display config (label/order/won/lost)

Revision ID: a1c9e4d7f203
Revises: b3a7c5e1f048
Create Date: 2026-08-24 00:00:00.000000

Phase 3 "Sales Automation", per docs/04_ROADMAP.md — a kanban board over
the existing `leads.status` (`LeadStatus`) pipeline, not a new set of
stage keys. `LeadStatus` already *is* the sales pipeline (see
docs/05_DECISIONS.md 2026-08-16, which explicitly rejected a second
parallel "what state is this lead in" field), so this table only adds
per-workspace board *display* config for each existing status value —
label, column order, and won/lost flags — reusing the existing
`lead_status` enum type (`create_type=False`) rather than defining a new
one. Rows are lazily seeded with defaults per workspace on first read
(`pipeline/service.py`'s `list_stages`), not backfilled here, so no data
migration is needed for existing workspaces.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a1c9e4d7f203'
down_revision: Union[str, None] = 'b3a7c5e1f048'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Plain sa.Enum(create_type=False) doesn't reliably suppress the implicit
# CREATE TYPE that op.create_table triggers on this SQLAlchemy version —
# postgresql.ENUM(create_type=False) does (see the meeting_reminder_channel
# fix in c392b641f8cb for the same issue).
lead_status_existing = postgresql.ENUM(
    'NEW', 'RESEARCHED', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'MEETING',
    'PROPOSAL', 'WON', 'LOST', 'NURTURE', name='lead_status', create_type=False,
)


def upgrade() -> None:
    op.create_table(
        'pipeline_stage_configs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('workspace_id', sa.UUID(), nullable=False),
        sa.Column('key', lead_status_existing, nullable=False),
        sa.Column('label', sa.String(length=60), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('is_won', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_lost', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'key', name='uq_pipeline_stage_workspace_key'),
    )


def downgrade() -> None:
    op.drop_table('pipeline_stage_configs')
