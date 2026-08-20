"""website generation: versioning + generation metadata

Revision ID: bf7f04e11e67
Revises: 6e90bb634a5f
Create Date: 2026-08-20 17:44:31.175674

Backs the website-generation system (roadmap M5): `websites` already
allowed multiple rows per project (no unique constraint), so versioning
("newest reviewed first", same convention as Sitemap/
CreativeDirectionBrief) needed no schema change there — this just adds
generation traceability (`generated_by_user_id`/`generated_at`) and the
Anti-Slop evaluation summary (`anti_slop_score`/`flagged_for_review`/
`sources_note`) alongside the existing `config` JSON column, which
already holds the full assembled site.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bf7f04e11e67'
down_revision: Union[str, None] = '6e90bb634a5f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('websites', sa.Column('anti_slop_score', sa.Integer(), nullable=True))
    op.add_column('websites', sa.Column('flagged_for_review', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('websites', sa.Column('sources_note', sa.Text(), nullable=True))
    op.add_column('websites', sa.Column('generated_by_user_id', sa.UUID(), nullable=True))
    op.add_column('websites', sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    op.create_foreign_key(
        'websites_generated_by_user_id_fkey', 'websites', 'users', ['generated_by_user_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('websites_generated_by_user_id_fkey', 'websites', type_='foreignkey')
    op.drop_column('websites', 'generated_at')
    op.drop_column('websites', 'generated_by_user_id')
    op.drop_column('websites', 'sources_note')
    op.drop_column('websites', 'flagged_for_review')
    op.drop_column('websites', 'anti_slop_score')
