"""prospect projects lead owned

Revision ID: a8f9da92d242
Revises: 32118c81e86f
Create Date: 2026-09-13 17:44:42.180289

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8f9da92d242'
down_revision: Union[str, None] = '32118c81e86f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('projects', 'client_id', existing_type=sa.UUID(), nullable=True)

    op.add_column('projects', sa.Column('workspace_id', sa.UUID(), nullable=True))
    op.execute(
        """
        UPDATE projects
        SET workspace_id = businesses.workspace_id
        FROM clients
        JOIN businesses ON businesses.id = clients.business_id
        WHERE projects.client_id = clients.id
        """
    )
    op.alter_column('projects', 'workspace_id', existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(
        'projects_workspace_id_fkey', 'projects', 'workspaces', ['workspace_id'], ['id'], ondelete='CASCADE'
    )
    op.create_index('ix_projects_workspace_id', 'projects', ['workspace_id'])

    op.create_check_constraint(
        'project_has_an_owner', 'projects', 'client_id IS NOT NULL OR source_lead_id IS NOT NULL'
    )


def downgrade() -> None:
    op.drop_constraint('project_has_an_owner', 'projects', type_='check')
    op.drop_index('ix_projects_workspace_id', table_name='projects')
    op.drop_constraint('projects_workspace_id_fkey', 'projects', type_='foreignkey')
    op.drop_column('projects', 'workspace_id')
    op.alter_column('projects', 'client_id', existing_type=sa.UUID(), nullable=False)
