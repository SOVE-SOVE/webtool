"""business_research_results: load_time_ms

Revision ID: b3a7c5e1f048
Revises: d5f7a3b8e912
Create Date: 2026-08-22 01:00:00.000000

Real, measured page-load timing for the website quality analysis stage
(agents/website_quality.py) — the "performance indicators" signal that
stage needs, which the initial research pass didn't capture. Same
"real number, never a fabricated score" reasoning as
website_audits.load_time_ms.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3a7c5e1f048'
down_revision: Union[str, None] = 'd5f7a3b8e912'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('business_research_results', sa.Column('load_time_ms', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('business_research_results', 'load_time_ms')
