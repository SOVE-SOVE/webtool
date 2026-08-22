"""lead intelligence architecture: discovery, business_research, website_quality, opportunity_scoring, jobs

Revision ID: d5f7a3b8e912
Revises: 0b9dfd5a2170
Create Date: 2026-08-22 00:00:00.000000

Phase 2 "Lead Intelligence" — the top-of-funnel pipeline that finds and
qualifies prospects *before* they become a `Lead` in the CRM, per
docs/04_ROADMAP.md. New tables:

- `discovery_searches` / `discovered_businesses`: an operator-run search
  and its normalized, deduplicated results — a reviewable list, not
  automatically imported into `businesses`/`leads`.
- `business_research_results`: per-candidate research, confirmed vs.
  inferred vs. unavailable, cached so the same business isn't
  re-researched needlessly.
- `website_quality_audits`: structured findings (category/severity/
  evidence/confidence) derived from research.
- `opportunity_score_results`: transparent, explainable scoring history.
- `jobs`: the background-work queue designed in
  docs/02_ARCHITECTURE.md §4 but never actually built until now — makes
  future scheduled discovery possible without a later schema change.

Enum labels are the Python enum member names (uppercase), matching every
other enum column in this schema (docs/05_DECISIONS.md convention noted
on the 98de6f66ba7b migration) — the API still reads/writes lowercase
`.value` strings over JSON regardless of what's stored in Postgres.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd5f7a3b8e912'
down_revision: Union[str, None] = '0b9dfd5a2170'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


discovery_search_status = sa.Enum('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', name='discovery_search_status')
discovered_business_status = sa.Enum(
    'NEW', 'RESEARCHED', 'AUDITED', 'SCORED', 'APPROVED', 'REJECTED', 'ARCHIVED', 'IMPORTED',
    name='discovered_business_status',
)
# Used on two tables (discovered_businesses.score_category,
# opportunity_score_results.category). The first table's create_table
# call creates the Postgres type as a side effect; the second reference
# must *not* try to create it again (`create_type=False`), or it 500s
# with "type already exists" — the shared `opportunity_score_category`
# instance below is that second, non-creating reference.
opportunity_score_category = sa.Enum('HOT', 'WARM', 'COLD', 'REVIEW', name='opportunity_score_category')
opportunity_score_category_existing = sa.Enum(
    'HOT', 'WARM', 'COLD', 'REVIEW', name='opportunity_score_category', create_type=False
)
job_status = sa.Enum('PENDING', 'RUNNING', 'DONE', 'FAILED', name='job_status')


def upgrade() -> None:
    op.create_table(
        'discovery_searches',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('workspace_id', sa.UUID(), nullable=False),
        sa.Column('created_by_user_id', sa.UUID(), nullable=True),
        sa.Column('query_label', sa.String(length=255), nullable=True),
        sa.Column('location', sa.String(length=255), nullable=True),
        sa.Column('industry', sa.String(length=120), nullable=True),
        sa.Column('business_type', sa.String(length=120), nullable=True),
        sa.Column('keywords', sa.String(length=500), nullable=True),
        sa.Column('min_score', sa.Integer(), nullable=True),
        sa.Column('max_score', sa.Integer(), nullable=True),
        sa.Column('has_website', sa.Boolean(), nullable=True),
        sa.Column('website_outdated', sa.Boolean(), nullable=True),
        sa.Column('provider', sa.String(length=50), nullable=False),
        sa.Column('status', discovery_search_status, nullable=False, server_default='PENDING'),
        sa.Column('result_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'discovered_businesses',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('discovery_search_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('industry', sa.String(length=120), nullable=True),
        sa.Column('business_type', sa.String(length=120), nullable=True),
        sa.Column('website_url', sa.String(length=500), nullable=True),
        sa.Column('phone', sa.String(length=50), nullable=True),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('address', sa.String(length=500), nullable=True),
        sa.Column('suburb', sa.String(length=120), nullable=True),
        sa.Column('state', sa.String(length=10), nullable=True),
        sa.Column('postcode', sa.String(length=10), nullable=True),
        sa.Column('social_links', sa.Text(), nullable=True),
        sa.Column('source_provider', sa.String(length=50), nullable=False),
        sa.Column('source_query', sa.String(length=500), nullable=True),
        sa.Column('source_external_id', sa.String(length=500), nullable=True),
        sa.Column('dedup_key', sa.String(length=500), nullable=False),
        sa.Column('duplicate_of_business_id', sa.UUID(), nullable=True),
        sa.Column('duplicate_of_discovered_business_id', sa.UUID(), nullable=True),
        sa.Column('status', discovered_business_status, nullable=False, server_default='NEW'),
        sa.Column('opportunity_score', sa.Integer(), nullable=True),
        sa.Column('score_category', opportunity_score_category, nullable=True),
        sa.Column('reviewed_by_user_id', sa.UUID(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('imported_lead_id', sa.UUID(), nullable=True),
        sa.Column('discovered_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['discovery_search_id'], ['discovery_searches.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['duplicate_of_business_id'], ['businesses.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(
            ['duplicate_of_discovered_business_id'], ['discovered_businesses.id'], ondelete='SET NULL'
        ),
        sa.ForeignKeyConstraint(['reviewed_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['imported_lead_id'], ['leads.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_discovered_businesses_dedup_key', 'discovered_businesses', ['dedup_key'])

    op.create_table(
        'business_research_results',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('discovered_business_id', sa.UUID(), nullable=False),
        sa.Column('official_website_url', sa.String(length=500), nullable=True),
        sa.Column('website_reachable', sa.Boolean(), nullable=True),
        sa.Column('https', sa.Boolean(), nullable=True),
        sa.Column('http_status', sa.Integer(), nullable=True),
        sa.Column('page_title', sa.String(length=500), nullable=True),
        sa.Column('meta_description', sa.Text(), nullable=True),
        sa.Column('mobile_viewport_present', sa.Boolean(), nullable=True),
        sa.Column('contact_cta_present', sa.Boolean(), nullable=True),
        sa.Column('estimated_site_age', sa.String(length=255), nullable=True),
        sa.Column('appears_template_or_placeholder', sa.Boolean(), nullable=True),
        sa.Column('technical_issues', sa.Text(), nullable=True),
        sa.Column('social_presence', sa.Text(), nullable=True),
        sa.Column('confirmed_facts', sa.Text(), nullable=True),
        sa.Column('inferred_facts', sa.Text(), nullable=True),
        sa.Column('unavailable_fields', sa.Text(), nullable=True),
        sa.Column('research_error', sa.Text(), nullable=True),
        sa.Column('researched_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['discovered_business_id'], ['discovered_businesses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'website_quality_audits',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('discovered_business_id', sa.UUID(), nullable=False),
        sa.Column('business_research_id', sa.UUID(), nullable=True),
        sa.Column('findings', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('issue_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('critical_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('audited_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['discovered_business_id'], ['discovered_businesses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['business_research_id'], ['business_research_results.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'opportunity_score_results',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('discovered_business_id', sa.UUID(), nullable=False),
        sa.Column('overall_score', sa.Integer(), nullable=False),
        sa.Column('category', opportunity_score_category_existing, nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('positive_signals', sa.Text(), nullable=True),
        sa.Column('negative_signals', sa.Text(), nullable=True),
        sa.Column('factors', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('recommendation_reason', sa.Text(), nullable=False),
        sa.Column('scored_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['discovered_business_id'], ['discovered_businesses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'jobs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('workspace_id', sa.UUID(), nullable=False),
        sa.Column('created_by_user_id', sa.UUID(), nullable=True),
        sa.Column('job_type', sa.String(length=50), nullable=False),
        sa.Column('status', job_status, nullable=False, server_default='PENDING'),
        sa.Column('payload', postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column('result', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('run_after', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_jobs_job_type', 'jobs', ['job_type'])


def downgrade() -> None:
    op.drop_index('ix_jobs_job_type', table_name='jobs')
    op.drop_table('jobs')
    op.drop_table('opportunity_score_results')
    op.drop_table('website_quality_audits')
    op.drop_table('business_research_results')
    op.drop_index('ix_discovered_businesses_dedup_key', table_name='discovered_businesses')
    op.drop_table('discovered_businesses')
    op.drop_table('discovery_searches')

    bind = op.get_bind()
    job_status.drop(bind)
    opportunity_score_category.drop(bind)
    discovered_business_status.drop(bind)
    discovery_search_status.drop(bind)
