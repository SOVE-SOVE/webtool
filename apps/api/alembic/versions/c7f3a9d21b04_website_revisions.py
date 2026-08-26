"""website_revisions table

Revision ID: c7f3a9d21b04
Revises: 731a8a798e83
Create Date: 2026-08-26 09:00:00.000000

Backs the website revision workflow (Phase 5 Part 3 Task 2): tracks
operator feedback on a generated website, the change actually made in
response, and its approval/rollback state — see
apps/api/app/modules/website_revisions/models.py and
apps/api/app/agents/website_revision.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c7f3a9d21b04'
down_revision: Union[str, None] = '731a8a798e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'website_revisions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('revision_number', sa.Integer(), nullable=False),
        sa.Column(
            'kind',
            postgresql.ENUM('CONTENT', 'SPACING', 'ROLLBACK', name='website_revision_kind'),
            nullable=False,
        ),
        sa.Column(
            'status',
            postgresql.ENUM('PENDING', 'APPROVED', 'REVERTED', name='website_revision_status'),
            nullable=False,
            server_default='PENDING',
        ),
        sa.Column('section_id', sa.String(length=64), nullable=True),
        sa.Column('section_type', sa.String(length=60), nullable=True),
        sa.Column('page_name', sa.String(length=200), nullable=True),
        sa.Column('requested_change', sa.Text(), nullable=False),
        sa.Column('generated_change', sa.Text(), nullable=False),
        sa.Column('previous_website_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('resulting_website_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('decided_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('decision_notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['previous_website_id'], ['websites.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['resulting_website_id'], ['websites.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['decided_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_website_revisions_project_id', 'website_revisions', ['project_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_website_revisions_project_id', table_name='website_revisions')
    op.drop_table('website_revisions')

    sa.Enum(name='website_revision_kind').drop(op.get_bind())
    sa.Enum(name='website_revision_status').drop(op.get_bind())
