"""design_briefs: full client intake fields, status, approval

Revision ID: f6b2d8c4a190
Revises: d4a9e2f7c1b3
Create Date: 2026-08-19 09:00:00.000000

Expands the design_briefs stub (goals/tone/pages) into the full
business/brand/content/website/assets client intake per
docs/04_ROADMAP.md M4 "Client intake form". One brief per project
(project_id now unique) — a missing field stays null rather than being
guessed at; docs/05_DECISIONS.md's "no JSON columns" convention applies
here too, so list-shaped fields (colours, testimonials, ...) are plain
Text, newline-separated.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f6b2d8c4a190'
down_revision: Union[str, None] = 'd4a9e2f7c1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('design_briefs', 'goals')
    op.drop_column('design_briefs', 'tone')
    op.drop_column('design_briefs', 'pages')

    # SQLAlchemy's Enum(PythonEnumClass) persists the member *name*
    # (DRAFT/APPROVED), not its lowercase .value — same convention as
    # lead_status/project_stage/opportunity_status in the initial schema.
    brief_status = sa.Enum('DRAFT', 'APPROVED', name='brief_status')
    brief_status.create(op.get_bind())
    op.add_column(
        'design_briefs',
        sa.Column('status', brief_status, nullable=False, server_default='DRAFT'),
    )

    # Business
    op.add_column('design_briefs', sa.Column('business_name', sa.String(length=255), nullable=True))
    op.add_column('design_briefs', sa.Column('industry', sa.String(length=120), nullable=True))
    op.add_column('design_briefs', sa.Column('location', sa.String(length=255), nullable=True))
    op.add_column('design_briefs', sa.Column('contact_name', sa.String(length=255), nullable=True))
    op.add_column('design_briefs', sa.Column('contact_email', sa.String(length=255), nullable=True))
    op.add_column('design_briefs', sa.Column('contact_phone', sa.String(length=50), nullable=True))
    op.add_column('design_briefs', sa.Column('business_description', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('services_products', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('target_customers', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('business_goals', sa.Text(), nullable=True))

    # Brand
    op.add_column('design_briefs', sa.Column('brand_name', sa.String(length=255), nullable=True))
    op.add_column('design_briefs', sa.Column('logo_notes', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('brand_colours', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('brand_fonts', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('brand_guidelines', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('visual_references', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('existing_social_profiles', sa.Text(), nullable=True))

    # Content
    op.add_column('design_briefs', sa.Column('about_content', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('services_content', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('products_content', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('content_contact_details', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('testimonials', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('faqs', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('calls_to_action', sa.Text(), nullable=True))

    # Website
    op.add_column('design_briefs', sa.Column('required_pages', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('required_functionality', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('existing_website_url', sa.String(length=500), nullable=True))
    op.add_column('design_briefs', sa.Column('domain', sa.String(length=255), nullable=True))
    op.add_column('design_briefs', sa.Column('hosting', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('integrations', sa.Text(), nullable=True))

    # Assets
    op.add_column('design_briefs', sa.Column('logo_assets', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('image_assets', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('video_assets', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('document_assets', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('existing_copy_assets', sa.Text(), nullable=True))

    # Approval / bookkeeping
    op.add_column('design_briefs', sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'design_briefs', sa.Column('approved_by_user_id', postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        'design_briefs',
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False
        ),
    )

    op.create_foreign_key(
        'design_briefs_approved_by_user_id_fkey',
        'design_briefs', 'users', ['approved_by_user_id'], ['id'], ondelete='SET NULL',
    )
    op.create_unique_constraint('design_briefs_project_id_key', 'design_briefs', ['project_id'])


def downgrade() -> None:
    op.drop_constraint('design_briefs_project_id_key', 'design_briefs', type_='unique')
    op.drop_constraint('design_briefs_approved_by_user_id_fkey', 'design_briefs', type_='foreignkey')

    op.drop_column('design_briefs', 'updated_at')
    op.drop_column('design_briefs', 'approved_by_user_id')
    op.drop_column('design_briefs', 'approved_at')

    op.drop_column('design_briefs', 'existing_copy_assets')
    op.drop_column('design_briefs', 'document_assets')
    op.drop_column('design_briefs', 'video_assets')
    op.drop_column('design_briefs', 'image_assets')
    op.drop_column('design_briefs', 'logo_assets')

    op.drop_column('design_briefs', 'integrations')
    op.drop_column('design_briefs', 'hosting')
    op.drop_column('design_briefs', 'domain')
    op.drop_column('design_briefs', 'existing_website_url')
    op.drop_column('design_briefs', 'required_functionality')
    op.drop_column('design_briefs', 'required_pages')

    op.drop_column('design_briefs', 'calls_to_action')
    op.drop_column('design_briefs', 'faqs')
    op.drop_column('design_briefs', 'testimonials')
    op.drop_column('design_briefs', 'content_contact_details')
    op.drop_column('design_briefs', 'products_content')
    op.drop_column('design_briefs', 'services_content')
    op.drop_column('design_briefs', 'about_content')

    op.drop_column('design_briefs', 'existing_social_profiles')
    op.drop_column('design_briefs', 'visual_references')
    op.drop_column('design_briefs', 'brand_guidelines')
    op.drop_column('design_briefs', 'brand_fonts')
    op.drop_column('design_briefs', 'brand_colours')
    op.drop_column('design_briefs', 'logo_notes')
    op.drop_column('design_briefs', 'brand_name')

    op.drop_column('design_briefs', 'business_goals')
    op.drop_column('design_briefs', 'target_customers')
    op.drop_column('design_briefs', 'services_products')
    op.drop_column('design_briefs', 'business_description')
    op.drop_column('design_briefs', 'contact_phone')
    op.drop_column('design_briefs', 'contact_email')
    op.drop_column('design_briefs', 'contact_name')
    op.drop_column('design_briefs', 'location')
    op.drop_column('design_briefs', 'industry')
    op.drop_column('design_briefs', 'business_name')

    op.drop_column('design_briefs', 'status')
    sa.Enum(name='brief_status').drop(op.get_bind())

    op.add_column('design_briefs', sa.Column('pages', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('tone', sa.Text(), nullable=True))
    op.add_column('design_briefs', sa.Column('goals', sa.Text(), nullable=True))
