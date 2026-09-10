"""ai_usage_events observability table

Revision ID: f9b5ad0ab10f
Revises: d8f3a6c2e719
Create Date: 2026-09-10 22:08:01.779005

One row per AI task execution, written by app/integrations/ai/router.py
(T6). Lightweight cost/debug visibility only — no prompts, responses,
business content, or secrets are stored (see
app/modules/ai_usage/models.py). `cost_usd` is 0.0 for local inference
(no API charge), an estimate for priced Anthropic models, NULL when
pricing is unknown.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f9b5ad0ab10f'
down_revision: Union[str, None] = 'd8f3a6c2e719'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ai_usage_events',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('task', sa.String(length=50), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('model', sa.String(length=100), nullable=False),
        sa.Column('success', sa.Boolean(), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=False),
        sa.Column('input_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column('retries', sa.Integer(), server_default='0', nullable=False),
        sa.Column('error_category', sa.String(length=40), nullable=True),
        sa.Column('cost_usd', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_ai_usage_events_created_at'), 'ai_usage_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_ai_usage_events_provider'), 'ai_usage_events', ['provider'], unique=False)
    op.create_index(op.f('ix_ai_usage_events_success'), 'ai_usage_events', ['success'], unique=False)
    op.create_index(op.f('ix_ai_usage_events_task'), 'ai_usage_events', ['task'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_ai_usage_events_task'), table_name='ai_usage_events')
    op.drop_index(op.f('ix_ai_usage_events_success'), table_name='ai_usage_events')
    op.drop_index(op.f('ix_ai_usage_events_provider'), table_name='ai_usage_events')
    op.drop_index(op.f('ix_ai_usage_events_created_at'), table_name='ai_usage_events')
    op.drop_table('ai_usage_events')
