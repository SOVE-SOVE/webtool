"""lead_scores: append-only scoring history for leads

Revision ID: 187a16497168
Revises: 8d2cff331d5c
Create Date: 2026-08-17 01:00:00.000000

New table for app/agents/lead_score.py's output — one row per scoring
run, never updated in place, so previous scores survive later re-scores
(e.g. after a new website audit changes the picture). See
docs/05_DECISIONS.md.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '187a16497168'
down_revision: Union[str, None] = '8d2cff331d5c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lead_scores',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_id', sa.UUID(), nullable=False),
        sa.Column('based_on_audit_id', sa.UUID(), nullable=True),
        sa.Column('overall_score', sa.Integer(), nullable=False),
        sa.Column('confidence', sa.Enum('LOW', 'MEDIUM', 'HIGH', name='score_confidence'), nullable=False),
        sa.Column('config_version', sa.Integer(), nullable=False),
        sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('results_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('scored_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['based_on_audit_id'], ['website_audits.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('lead_scores')
    sa.Enum(name='score_confidence').drop(op.get_bind())
