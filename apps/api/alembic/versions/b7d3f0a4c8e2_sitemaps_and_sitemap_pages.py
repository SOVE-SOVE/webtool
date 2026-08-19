"""sitemaps and sitemap_pages

Revision ID: b7d3f0a4c8e2
Revises: e1c7b6a2d4f9
Create Date: 2026-08-19 12:00:00.000000

Backs the website sitemap/planning system (roadmap M4): given a
completed client brief and creative direction, generate a recommended
website structure for operator review/edit/approval before build work
starts. See apps/api/app/agents/sitemap.py and
apps/api/app/modules/sitemaps/.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b7d3f0a4c8e2'
down_revision: Union[str, None] = 'e1c7b6a2d4f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'sitemaps',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            'status',
            postgresql.ENUM('draft', 'approved', name='sitemap_status'),
            nullable=False,
            server_default='draft',
        ),
        sa.Column('overview', sa.Text(), nullable=True),
        sa.Column('creative_direction_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('sources_note', sa.Text(), nullable=True),
        sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('model_used', sa.String(length=100), nullable=True),
        sa.Column('prompt_version', sa.String(length=50), nullable=True),
        sa.Column('generated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('approved_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['creative_direction_id'], ['creative_direction_briefs.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['generated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'sitemap_pages',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('sitemap_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('parent_page_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('slug', sa.String(length=255), nullable=False),
        sa.Column(
            'page_type',
            postgresql.ENUM(
                'home', 'about', 'services', 'service_detail', 'products', 'product_detail',
                'contact', 'faq', 'testimonials', 'portfolio', 'blog', 'blog_post', 'custom',
                name='sitemap_page_type',
            ),
            nullable=False,
            server_default='custom',
        ),
        sa.Column(
            'nav_placement',
            postgresql.ENUM(
                'primary_nav', 'footer_nav', 'primary_and_footer', 'not_in_nav',
                name='sitemap_nav_placement',
            ),
            nullable=False,
            server_default='primary_nav',
        ),
        sa.Column('order_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('purpose', sa.Text(), nullable=False),
        sa.Column('primary_cta', sa.String(length=255), nullable=True),
        sa.Column('secondary_cta', sa.String(length=255), nullable=True),
        sa.Column('key_sections', sa.Text(), nullable=True),
        sa.Column('required_content', sa.Text(), nullable=True),
        sa.Column('required_functionality', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['sitemap_id'], ['sitemaps.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['parent_page_id'], ['sitemap_pages.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('sitemap_pages')
    op.drop_table('sitemaps')

    sa.Enum(name='sitemap_nav_placement').drop(op.get_bind())
    sa.Enum(name='sitemap_page_type').drop(op.get_bind())
    sa.Enum(name='sitemap_status').drop(op.get_bind())
