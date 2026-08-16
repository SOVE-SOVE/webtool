"""workspaces, users, activity_log; assignment + workspace scoping

Revision ID: 7f1aabd7eb7d
Revises: 0477e5be0f99
Create Date: 2026-08-16 22:00:00.000000

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7f1aabd7eb7d'
down_revision: Union[str, None] = '0477e5be0f99'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('workspaces',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('users',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('role', sa.Enum('ADMIN', 'MEMBER', name='user_role'), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('activity_log',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('entity_type', sa.String(length=50), nullable=False),
    sa.Column('entity_id', sa.UUID(), nullable=False),
    sa.Column('action', sa.String(length=50), nullable=False),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )

    # businesses.workspace_id: added nullable, backfilled into a single
    # default workspace if any businesses already exist, then locked to
    # NOT NULL — safe whether this runs against an empty dev DB or one
    # with real rows.
    op.add_column('businesses', sa.Column('workspace_id', sa.UUID(), nullable=True))
    connection = op.get_bind()
    has_existing_businesses = connection.execute(sa.text('SELECT 1 FROM businesses LIMIT 1')).first()
    if has_existing_businesses is not None:
        default_workspace_id = str(uuid.uuid4())
        connection.execute(
            sa.text(
                "INSERT INTO workspaces (id, name, created_at, updated_at) "
                "VALUES (:id, 'Default Workspace', now(), now())"
            ),
            {"id": default_workspace_id},
        )
        connection.execute(
            sa.text('UPDATE businesses SET workspace_id = :id WHERE workspace_id IS NULL'),
            {"id": default_workspace_id},
        )
    op.alter_column('businesses', 'workspace_id', nullable=False)
    op.create_foreign_key(
        'businesses_workspace_id_fkey', 'businesses', 'workspaces', ['workspace_id'], ['id'], ondelete='CASCADE'
    )

    op.add_column('leads', sa.Column('assigned_user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'leads_assigned_user_id_fkey', 'leads', 'users', ['assigned_user_id'], ['id'], ondelete='SET NULL'
    )

    op.add_column('clients', sa.Column('assigned_user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'clients_assigned_user_id_fkey', 'clients', 'users', ['assigned_user_id'], ['id'], ondelete='SET NULL'
    )

    op.add_column('projects', sa.Column('assigned_user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'projects_assigned_user_id_fkey', 'projects', 'users', ['assigned_user_id'], ['id'], ondelete='SET NULL'
    )

    op.add_column('tasks', sa.Column('assigned_user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'tasks_assigned_user_id_fkey', 'tasks', 'users', ['assigned_user_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('tasks_assigned_user_id_fkey', 'tasks', type_='foreignkey')
    op.drop_column('tasks', 'assigned_user_id')

    op.drop_constraint('projects_assigned_user_id_fkey', 'projects', type_='foreignkey')
    op.drop_column('projects', 'assigned_user_id')

    op.drop_constraint('clients_assigned_user_id_fkey', 'clients', type_='foreignkey')
    op.drop_column('clients', 'assigned_user_id')

    op.drop_constraint('leads_assigned_user_id_fkey', 'leads', type_='foreignkey')
    op.drop_column('leads', 'assigned_user_id')

    op.drop_constraint('businesses_workspace_id_fkey', 'businesses', type_='foreignkey')
    op.drop_column('businesses', 'workspace_id')

    op.drop_table('activity_log')
    op.drop_table('users')
    op.drop_table('workspaces')
