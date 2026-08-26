"""business_research_results: provider, confidence

Revision ID: 8e8d2a184274
Revises: 6594b6136758
Create Date: 2026-08-26

Phase 7 Task 3 ("scheduled website research") — records the research
method's own confidence (previously computed by agents/business_research.py
and discarded) and which method produced the result, per the spec's
"record research timestamp, provider, result, errors, confidence".
"""

from alembic import op
import sqlalchemy as sa

revision = "8e8d2a184274"
down_revision = "6594b6136758"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "business_research_results",
        sa.Column("provider", sa.String(length=50), nullable=False, server_default="browser"),
    )
    op.add_column("business_research_results", sa.Column("confidence", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("business_research_results", "confidence")
    op.drop_column("business_research_results", "provider")
