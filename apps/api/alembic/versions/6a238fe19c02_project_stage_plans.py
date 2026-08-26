"""project workspace: project_stage_plans, tasks.stage

Revision ID: 6a238fe19c02
Revises: a1c9e4d7f203
Create Date: 2026-08-26 00:00:00.000000

Automatic project creation from an approved client brief (docs/04_ROADMAP.md
M4's "intake -> project" line, extended past the brief itself): approving a
project's brief now seeds a full editable project workspace — one
`project_stage_plans` row per pipeline stage (a responsible person, a
default due date, and whether that stage needs an explicit approval before
the project can move past it), plus a starter task checklist per stage on
the existing `tasks` table (see `project_plans/service.py::
create_plan_for_project`, called from `design_briefs/service.py::
approve_brief`). Every field seeded is immediately, freely editable — this
is a starting point, not a fixed workflow, same contract as the existing
DEFAULT_INTAKE_TASK_TITLES/DEFAULT_LAUNCH_TASK_TITLES checklists.

Reuses the existing `project_stage` enum type (`create_type=False`) for
both the new table's `stage` column and the new nullable `tasks.stage`
column — no new stage vocabulary, just data (and, for tasks, an optional
grouping tag) hung off the one that already exists.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '6a238fe19c02'
down_revision: Union[str, None] = 'a1c9e4d7f203'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Plain sa.Enum(create_type=False) doesn't reliably suppress the implicit
# CREATE TYPE that op.create_table/op.add_column triggers on this
# SQLAlchemy version — postgresql.ENUM(create_type=False) does (see the
# pipeline_stage_configs migration for the same fix).
project_stage_existing = postgresql.ENUM(
    'INTAKE', 'RESEARCH', 'BRIEF', 'DESIGN', 'DEVELOPMENT', 'QA',
    'CLIENT_REVIEW', 'REVISIONS', 'READY_TO_DEPLOY', 'DEPLOYED',
    'MAINTENANCE', 'COMPLETE', name='project_stage', create_type=False,
)

plan_stage_status = postgresql.ENUM(
    'PENDING', 'IN_PROGRESS', 'DONE', name='plan_stage_status',
)


def upgrade() -> None:
    plan_stage_status.create(op.get_bind())

    op.create_table(
        'project_stage_plans',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('stage', project_stage_existing, nullable=False),
        sa.Column('label', sa.String(length=255), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('responsible_user_id', sa.UUID(), nullable=True),
        sa.Column('due_at', sa.Date(), nullable=True),
        sa.Column('requires_approval', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('status', plan_stage_status, nullable=False, server_default='PENDING'),
        sa.Column('approved', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('approved_by_user_id', sa.UUID(), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['responsible_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['approved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'stage', name='uq_project_stage_plan'),
    )

    op.add_column('tasks', sa.Column('stage', project_stage_existing, nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'stage')
    op.drop_table('project_stage_plans')
    plan_stage_status.drop(op.get_bind())
