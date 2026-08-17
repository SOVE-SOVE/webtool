"""website_audits: technical detail columns; new sales_audit_reports table

Revision ID: a3f8c1d92b44
Revises: 98de6f66ba7b
Create Date: 2026-08-17 12:00:00.000000

Backs the Sales Audit feature. `page_speed_score` is left untouched and
deliberately unpopulated by this feature — `load_time_ms` is the real,
measured evidence used instead (see docs/03_AGENT_RULES.md and the
"no unsupported claims" requirement).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a3f8c1d92b44'
down_revision: Union[str, None] = '98de6f66ba7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('website_audits', sa.Column('load_time_ms', sa.Integer(), nullable=True))
    op.add_column('website_audits', sa.Column('title', sa.String(length=500), nullable=True))
    op.add_column('website_audits', sa.Column('meta_description', sa.Text(), nullable=True))
    op.add_column('website_audits', sa.Column('viewport_meta_present', sa.Boolean(), nullable=True))
    op.add_column('website_audits', sa.Column('audit_error', sa.Text(), nullable=True))

    op.create_table(
        'sales_audit_reports',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('lead_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('website_audit_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('business_summary', sa.Text(), nullable=False),
        sa.Column('website_strengths', sa.Text(), nullable=False),
        sa.Column('top_problems', sa.Text(), nullable=False),
        sa.Column('why_problems_matter', sa.Text(), nullable=False),
        sa.Column('recommended_improvements', sa.Text(), nullable=False),
        sa.Column('suggested_structure', sa.Text(), nullable=False),
        sa.Column('talking_points', sa.Text(), nullable=False),
        sa.Column('potential_objections', sa.Text(), nullable=False),
        sa.Column('suggested_offer', sa.Text(), nullable=False),
        sa.Column('sources_note', sa.Text(), nullable=True),
        sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('model_used', sa.String(length=100), nullable=False),
        sa.Column('prompt_version', sa.String(length=50), nullable=False),
        sa.Column('generated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['website_audit_id'], ['website_audits.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['generated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('sales_audit_reports')

    op.drop_column('website_audits', 'audit_error')
    op.drop_column('website_audits', 'viewport_meta_present')
    op.drop_column('website_audits', 'meta_description')
    op.drop_column('website_audits', 'title')
    op.drop_column('website_audits', 'load_time_ms')
