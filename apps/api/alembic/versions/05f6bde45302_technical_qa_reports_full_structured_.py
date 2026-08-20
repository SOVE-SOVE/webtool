"""technical QA reports: full structured report, preview_url, generated_by

Revision ID: 05f6bde45302
Revises: bf7f04e11e67
Create Date: 2026-08-20 18:17:25.062518

Backs the technical QA system (roadmap M5): `qa_reports` already
allowed multiple rows per website (no unique constraint), so re-running
QA after an edit needed no new versioning mechanism — this adds the
full structured result (`report`, every check not just pass/fail),
which preview URL (if any) it ran against, and who triggered it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '05f6bde45302'
down_revision: Union[str, None] = 'bf7f04e11e67'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('qa_reports', sa.Column('report', sa.JSON(), nullable=True))
    op.add_column('qa_reports', sa.Column('preview_url', sa.String(length=500), nullable=True))
    op.add_column('qa_reports', sa.Column('generated_by_user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'qa_reports_generated_by_user_id_fkey', 'qa_reports', 'users', ['generated_by_user_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('qa_reports_generated_by_user_id_fkey', 'qa_reports', type_='foreignkey')
    op.drop_column('qa_reports', 'generated_by_user_id')
    op.drop_column('qa_reports', 'preview_url')
    op.drop_column('qa_reports', 'report')
