"""lead planning rework

Revision ID: c7e4a2f9b1d6
Revises: b3d6f9a1c8e5
Create Date: 2026-09-09 00:00:00.000000

Reworks Planning from a Project/Build-step feature into its own
standalone workspace created from a Lead, before any Project exists
(docs/05_DECISIONS.md). The previous pass (b3d6f9a1c8e5) put Planning
in the wrong place — inside a Project's Build section, keyed off
`website_audits.business_id` for projects with no source Lead. No real
`project_planning` rows were ever created in production (verified
before writing this migration), so this is a clean drop-and-recreate,
not a data migration:

- `project_planning` is dropped; `lead_planning` replaces it, keyed off
  `lead_id` (not unique — a lead accumulates a history of analysis
  runs, one per "Analyse Website" click, same append-only-generations
  shape as `sales_audit_reports` / `creative_direction_briefs`) with a
  `status` column driving the ready_to_analyse -> analysing ->
  completed/needs_review/failed lifecycle that the background job
  (JOB_PLANNING_ANALYSIS) advances.
- `website_audits.business_id` (and its lead_id-xor-business_id check
  constraint) is reverted — Planning now always has a Lead, so the
  original lead_id-only shape returns. The `findings` /
  `extended_signals` / screenshot columns added alongside it stay: they
  remain genuinely reused, just always populated via `lead_id` now.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c7e4a2f9b1d6'
down_revision: Union[str, None] = 'b3d6f9a1c8e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('project_planning')

    op.drop_constraint('ck_website_audits_lead_xor_business', 'website_audits', type_='check')
    op.drop_constraint('fk_website_audits_business_id', 'website_audits', type_='foreignkey')
    op.drop_column('website_audits', 'business_id')
    op.alter_column('website_audits', 'lead_id', existing_type=sa.UUID(), nullable=False)

    # Enum labels are the Python enum member NAMES (uppercase), matching
    # every other enum column in this schema (docs/05_DECISIONS.md
    # convention, see the 98de6f66ba7b migration) — the API still reads/
    # writes lowercase `.value` strings over JSON regardless of what's
    # stored in Postgres.
    planning_status = postgresql.ENUM(
        'READY_TO_ANALYSE', 'ANALYSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED', name='planning_status'
    )

    op.create_table(
        'lead_planning',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_id', sa.UUID(), nullable=False),
        sa.Column('website_url', sa.String(length=500), nullable=False),
        sa.Column('website_audit_id', sa.UUID(), nullable=True),
        sa.Column('status', planning_status, nullable=False, server_default='READY_TO_ANALYSE'),
        sa.Column('website_summary', sa.Text(), nullable=True),
        sa.Column('key_points', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('operator_notes', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('analysed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_id'], ['leads.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['website_audit_id'], ['website_audits.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_lead_planning_lead_id', 'lead_planning', ['lead_id'])


def downgrade() -> None:
    op.drop_index('ix_lead_planning_lead_id', table_name='lead_planning')
    op.drop_table('lead_planning')
    op.execute('DROP TYPE planning_status')

    op.alter_column('website_audits', 'lead_id', existing_type=sa.UUID(), nullable=True)
    op.add_column('website_audits', sa.Column('business_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'fk_website_audits_business_id', 'website_audits', 'businesses', ['business_id'], ['id'], ondelete='CASCADE'
    )
    op.create_check_constraint(
        'ck_website_audits_lead_xor_business',
        'website_audits',
        '(lead_id IS NOT NULL) != (business_id IS NOT NULL)',
    )

    op.create_table(
        'project_planning',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('website_audit_id', sa.UUID(), nullable=True),
        sa.Column('website_summary', sa.Text(), nullable=True),
        sa.Column('summary_source', sa.String(length=20), nullable=True),
        sa.Column('key_points', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('operator_notes', sa.Text(), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['website_audit_id'], ['website_audits.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', name='uq_project_planning_project_id'),
    )
