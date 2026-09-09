"""planning workspace

Revision ID: b3d6f9a1c8e5
Revises: c9d3e7f2a5b8
Create Date: 2026-09-09 00:00:00.000000

Planning: the neutral, evidence-backed "understand this prospect and
prepare the build" workspace added to a Project's existing Build
workspace (docs/05_DECISIONS.md). Two schema changes:

- `website_audits` gets a nullable `business_id` (alongside the
  existing, now-nullable `lead_id`) so Planning can run the same audit
  directly against a project's business — a project created
  independently of a lead conversion has no Lead record to attach an
  audit to. A check constraint keeps exactly one of the two set.
  `findings` / `extended_signals` / the two screenshot columns are only
  ever populated by a business_id-scoped (Planning) audit; every
  existing lead-scoped row leaves them null.
- `project_planning`: one row per project holding the current,
  operator-editable Website Summary draft, the generated Key Points
  (a snapshot of the audit's findings, not independently editable),
  and free-text Operator Notes — kept alongside which WebsiteAudit
  backed the current generated draft so regenerating never silently
  discards an operator's own edits (`summary_source` distinguishes a
  fresh "generated" draft from one the operator has "edited").
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b3d6f9a1c8e5'
down_revision: Union[str, None] = 'c9d3e7f2a5b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('website_audits', 'lead_id', existing_type=sa.UUID(), nullable=True)
    op.add_column('website_audits', sa.Column('business_id', sa.UUID(), nullable=True))
    op.add_column(
        'website_audits',
        sa.Column('findings', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )
    op.add_column('website_audits', sa.Column('extended_signals', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('website_audits', sa.Column('screenshot_desktop_base64', sa.Text(), nullable=True))
    op.add_column('website_audits', sa.Column('screenshot_mobile_base64', sa.Text(), nullable=True))
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


def downgrade() -> None:
    op.drop_table('project_planning')
    op.drop_constraint('ck_website_audits_lead_xor_business', 'website_audits', type_='check')
    op.drop_constraint('fk_website_audits_business_id', 'website_audits', type_='foreignkey')
    op.drop_column('website_audits', 'screenshot_mobile_base64')
    op.drop_column('website_audits', 'screenshot_desktop_base64')
    op.drop_column('website_audits', 'extended_signals')
    op.drop_column('website_audits', 'findings')
    op.drop_column('website_audits', 'business_id')
    op.alter_column('website_audits', 'lead_id', existing_type=sa.UUID(), nullable=False)
