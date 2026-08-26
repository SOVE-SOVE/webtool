"""creative direction spacing/component style + conversion goal

Revision ID: f4a1c8e3b56d
Revises: 731a8a798e83
Create Date: 2026-08-26 00:00:00.000000

Phase 5 task 2 ("add AI design direction"): the design-direction
generator's output was missing an explicit spacing system and component
style, and had no first-class conversion_goal input alongside the
existing target_audience/business_goals — see
docs/08_WEBSITE_GENERATION.md and app/agents/creative_director.py.
spacing_system/component_style get a server_default of '' since
existing rows predate this generation and have no value for them (same
approach as other backfill-free additive text columns in this history,
e.g. 616cd61e28f9's approval_notes columns); conversion_goal is
nullable, matching target_audience/business_goals.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a1c8e3b56d'
down_revision: Union[str, None] = '731a8a798e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('creative_direction_briefs', sa.Column('conversion_goal', sa.Text(), nullable=True))
    op.add_column(
        'creative_direction_briefs',
        sa.Column('spacing_system', sa.Text(), nullable=False, server_default=''),
    )
    op.add_column(
        'creative_direction_briefs',
        sa.Column('component_style', sa.Text(), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('creative_direction_briefs', 'component_style')
    op.drop_column('creative_direction_briefs', 'spacing_system')
    op.drop_column('creative_direction_briefs', 'conversion_goal')
