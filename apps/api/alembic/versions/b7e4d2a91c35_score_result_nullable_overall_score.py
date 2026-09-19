"""opportunity score results: overall_score may be NULL (score unavailable)

A failed website analysis must not produce a numeric score (it used to
record 90+ "site_unreachable" points). NULL means "unavailable" and stays
distinct from a real 0. Existing rows are untouched.

Revision ID: b7e4d2a91c35
Revises: a1c3e8f0d2b4
"""

import sqlalchemy as sa
from alembic import op

revision = "b7e4d2a91c35"
down_revision = "a1c3e8f0d2b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("opportunity_score_results", "overall_score", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Unavailable scores have no honest integer; drop them before restoring NOT NULL.
    op.execute("DELETE FROM opportunity_score_results WHERE overall_score IS NULL")
    op.alter_column("opportunity_score_results", "overall_score", existing_type=sa.Integer(), nullable=False)
