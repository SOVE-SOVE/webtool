"""human approval workflow: website/qa_report/deployment approval fields

Revision ID: 616cd61e28f9
Revises: 05f6bde45302
Create Date: 2026-08-20 18:38:17.934521

Backs the human approval workflow (docs/05_DECISIONS.md): checkpoints
4 ("Generated website") and 6 ("Client review") land on `websites`
(one version can be both operator-approved and, once QA is also
approved, client-approved), checkpoint 5 ("QA") on `qa_reports` as a
human sign-off distinct from its own automated `passed` verdict, and
checkpoint 7 ("Final deployment") on `deployments` — creating a row IS
that checkpoint's approval record. Checkpoints 1-3 (client brief,
creative direction, sitemap) already had status/approved_by/approved_at
columns from earlier work; no schema change needed there.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '616cd61e28f9'
down_revision: Union[str, None] = '05f6bde45302'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('deployments', sa.Column('approved_by_user_id', sa.UUID(), nullable=True))
    op.add_column('deployments', sa.Column('notes', sa.Text(), nullable=True))
    op.create_foreign_key(
        'deployments_approved_by_user_id_fkey', 'deployments', 'users', ['approved_by_user_id'], ['id'], ondelete='SET NULL'
    )

    op.add_column('qa_reports', sa.Column('human_approved', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('qa_reports', sa.Column('approved_by_user_id', sa.UUID(), nullable=True))
    op.add_column('qa_reports', sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('qa_reports', sa.Column('approval_notes', sa.Text(), nullable=True))
    op.create_foreign_key(
        'qa_reports_approved_by_user_id_fkey', 'qa_reports', 'users', ['approved_by_user_id'], ['id'], ondelete='SET NULL'
    )

    op.add_column('websites', sa.Column('approved', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('websites', sa.Column('approved_by_user_id', sa.UUID(), nullable=True))
    op.add_column('websites', sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('websites', sa.Column('approval_notes', sa.Text(), nullable=True))
    op.add_column('websites', sa.Column('client_approved', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('websites', sa.Column('client_approved_by_user_id', sa.UUID(), nullable=True))
    op.add_column('websites', sa.Column('client_approved_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('websites', sa.Column('client_approval_notes', sa.Text(), nullable=True))
    op.create_foreign_key(
        'websites_client_approved_by_user_id_fkey', 'websites', 'users', ['client_approved_by_user_id'], ['id'], ondelete='SET NULL'
    )
    op.create_foreign_key(
        'websites_approved_by_user_id_fkey', 'websites', 'users', ['approved_by_user_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('websites_approved_by_user_id_fkey', 'websites', type_='foreignkey')
    op.drop_constraint('websites_client_approved_by_user_id_fkey', 'websites', type_='foreignkey')
    op.drop_column('websites', 'client_approval_notes')
    op.drop_column('websites', 'client_approved_at')
    op.drop_column('websites', 'client_approved_by_user_id')
    op.drop_column('websites', 'client_approved')
    op.drop_column('websites', 'approval_notes')
    op.drop_column('websites', 'approved_at')
    op.drop_column('websites', 'approved_by_user_id')
    op.drop_column('websites', 'approved')

    op.drop_constraint('qa_reports_approved_by_user_id_fkey', 'qa_reports', type_='foreignkey')
    op.drop_column('qa_reports', 'approval_notes')
    op.drop_column('qa_reports', 'approved_at')
    op.drop_column('qa_reports', 'approved_by_user_id')
    op.drop_column('qa_reports', 'human_approved')

    op.drop_constraint('deployments_approved_by_user_id_fkey', 'deployments', type_='foreignkey')
    op.drop_column('deployments', 'notes')
    op.drop_column('deployments', 'approved_by_user_id')
