"""sitemap page target audience/conversion goal/seo intent/required assets

Revision ID: c9d3e7f2a184
Revises: f4a1c8e3b56d
Create Date: 2026-08-26 00:05:00.000000

Phase 5 task 3 ("add AI sitemap planning"): per-page planning was
missing four of the fields the operator's brief called for — target
audience, conversion goal, SEO intent, and required assets (distinct
from required_content, which is written/informational only) — see
docs/08_WEBSITE_GENERATION.md and app/agents/sitemap.py. All four are
nullable: existing pages predate this generation and target_audience/
conversion_goal/seo_intent are also optional per-page by design (only
set when a page's audience/goal genuinely differs from the sitemap's
overall one).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d3e7f2a184'
down_revision: Union[str, None] = 'f4a1c8e3b56d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sitemap_pages', sa.Column('target_audience', sa.Text(), nullable=True))
    op.add_column('sitemap_pages', sa.Column('conversion_goal', sa.Text(), nullable=True))
    op.add_column('sitemap_pages', sa.Column('seo_intent', sa.Text(), nullable=True))
    op.add_column('sitemap_pages', sa.Column('required_assets', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('sitemap_pages', 'required_assets')
    op.drop_column('sitemap_pages', 'seo_intent')
    op.drop_column('sitemap_pages', 'conversion_goal')
    op.drop_column('sitemap_pages', 'target_audience')
