"""website_audits: url/status/results_json/report_markdown/flagged_for_review/error, drop notes

Revision ID: 8d2cff331d5c
Revises: 98de6f66ba7b
Create Date: 2026-08-17 00:30:00.000000

Extends `website_audits` to store the full structured output of the
website-audit engine (app/agents/website_audit.py) — see
docs/05_DECISIONS.md. The table was previously write-only (no route
ever populated it), so there's no real data to migrate; existing rows
(if any, e.g. from local testing) are backfilled with placeholder
values before the new NOT NULL constraints are applied.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '8d2cff331d5c'
down_revision: Union[str, None] = '98de6f66ba7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    website_audit_status = sa.Enum('SUCCESS', 'BLOCKED', 'FAILED', name='website_audit_status')
    website_audit_status.create(op.get_bind())

    op.add_column('website_audits', sa.Column('url', sa.String(length=500), nullable=True))
    op.add_column('website_audits', sa.Column('status', website_audit_status, nullable=True))
    op.add_column('website_audits', sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('website_audits', sa.Column('error', sa.Text(), nullable=True))
    op.add_column('website_audits', sa.Column('results_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('website_audits', sa.Column('report_markdown', sa.Text(), nullable=True))

    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE website_audits SET "
            "url = COALESCE(url, ''), "
            "status = COALESCE(status, CAST('FAILED' AS website_audit_status)), "
            "results_json = COALESCE(results_json, '{}'::jsonb), "
            "report_markdown = COALESCE(report_markdown, '')"
        )
    )

    op.alter_column('website_audits', 'url', nullable=False)
    op.alter_column('website_audits', 'status', nullable=False)
    op.alter_column('website_audits', 'results_json', nullable=False)
    op.alter_column('website_audits', 'report_markdown', nullable=False)

    op.drop_column('website_audits', 'notes')


def downgrade() -> None:
    op.add_column('website_audits', sa.Column('notes', sa.Text(), nullable=True))

    op.drop_column('website_audits', 'report_markdown')
    op.drop_column('website_audits', 'results_json')
    op.drop_column('website_audits', 'error')
    op.drop_column('website_audits', 'flagged_for_review')
    op.drop_column('website_audits', 'status')
    op.drop_column('website_audits', 'url')

    sa.Enum(name='website_audit_status').drop(op.get_bind())
