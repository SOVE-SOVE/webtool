"""planning content draft

Revision ID: ca0a45a263c8
Revises: d2b366f7a047
Create Date: 2026-09-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'ca0a45a263c8'
down_revision: Union[str, None] = 'd2b366f7a047'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Labels are the Python enum's *names* (upper-case) — same convention as
# every other LeadPlanning enum. create_type=False on each: they're
# created exactly once via their own explicit .create() call below, not
# implicitly by create_table's column-type visitor (both firing in the
# same transaction fails with "type already exists" — hit and fixed in
# an earlier migration this session).
content_draft_status = postgresql.ENUM(
    'GENERATING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED', name='content_draft_status', create_type=False
)
content_page_status = postgresql.ENUM('DRAFT', 'EDITED', 'APPROVED', name='content_page_status', create_type=False)
content_source = postgresql.ENUM('GENERATED', 'OPERATOR_EDITED', name='content_source', create_type=False)


def upgrade() -> None:
    content_draft_status.create(op.get_bind(), checkfirst=True)
    content_page_status.create(op.get_bind(), checkfirst=True)
    content_source.create(op.get_bind(), checkfirst=True)

    # LeadPlanning: Content Draft run bookkeeping.
    op.add_column('lead_planning', sa.Column('content_draft_status', content_draft_status, nullable=True))
    op.add_column('lead_planning', sa.Column('content_draft_progress_label', sa.Text(), nullable=True))
    op.add_column('lead_planning', sa.Column('content_draft_generated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('lead_planning', sa.Column('content_draft_error', sa.Text(), nullable=True))

    # Approved Build Brief snapshot gains the Content Draft slice.
    op.add_column(
        'lead_planning_approved_briefs',
        sa.Column('content_draft_snapshot', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
    )

    # Real Sitemap pipeline: optional per-page SEO overrides from an
    # approved Content Draft page at Create Project handoff.
    op.add_column('sitemap_pages', sa.Column('seo_title', sa.String(length=255), nullable=True))
    op.add_column('sitemap_pages', sa.Column('seo_meta_description', sa.Text(), nullable=True))

    op.create_table(
        'lead_planning_content_pages',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('lead_planning_id', sa.UUID(), nullable=False),
        sa.Column('sitemap_page_id', sa.UUID(), nullable=False),
        sa.Column('seo_title', sa.Text(), nullable=True),
        sa.Column('seo_meta_description', sa.Text(), nullable=True),
        sa.Column('status', content_page_status, nullable=False, server_default='DRAFT'),
        sa.Column('approved_source_fingerprint', sa.String(length=64), nullable=True),
        sa.Column('approved_by_user_id', sa.UUID(), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['lead_planning_id'], ['lead_planning.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sitemap_page_id'], ['lead_planning_sitemap_pages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_lead_planning_content_pages_lead_planning_id', 'lead_planning_content_pages', ['lead_planning_id']
    )
    op.create_index(
        'ix_lead_planning_content_pages_sitemap_page_id', 'lead_planning_content_pages', ['sitemap_page_id']
    )

    op.create_table(
        'lead_planning_content_sections',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('content_page_id', sa.UUID(), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('section_type', sa.String(length=50), nullable=False),
        sa.Column('content', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('needs_confirmation_notes', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('source', content_source, nullable=False, server_default='GENERATED'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['content_page_id'], ['lead_planning_content_pages.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_lead_planning_content_sections_content_page_id', 'lead_planning_content_sections', ['content_page_id']
    )


def downgrade() -> None:
    op.drop_index('ix_lead_planning_content_sections_content_page_id', table_name='lead_planning_content_sections')
    op.drop_table('lead_planning_content_sections')

    op.drop_index('ix_lead_planning_content_pages_sitemap_page_id', table_name='lead_planning_content_pages')
    op.drop_index('ix_lead_planning_content_pages_lead_planning_id', table_name='lead_planning_content_pages')
    op.drop_table('lead_planning_content_pages')

    op.drop_column('sitemap_pages', 'seo_meta_description')
    op.drop_column('sitemap_pages', 'seo_title')

    op.drop_column('lead_planning_approved_briefs', 'content_draft_snapshot')

    op.drop_column('lead_planning', 'content_draft_error')
    op.drop_column('lead_planning', 'content_draft_generated_at')
    op.drop_column('lead_planning', 'content_draft_progress_label')
    op.drop_column('lead_planning', 'content_draft_status')

    content_source.drop(op.get_bind(), checkfirst=True)
    content_page_status.drop(op.get_bind(), checkfirst=True)
    content_draft_status.drop(op.get_bind(), checkfirst=True)
