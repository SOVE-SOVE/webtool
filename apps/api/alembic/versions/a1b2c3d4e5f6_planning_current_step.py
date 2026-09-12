"""add lead_planning.current_step for real analysis progress

Revision ID: a1b2c3d4e5f6
Revises: fe3c2ead557c
Create Date: 2026-09-13 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'fe3c2ead557c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Labels are the Python enum's *names* (upper-case), not its values —
# matching this repo's existing convention for str-mixin enum columns
# (see planning_status: 'READY_TO_ANALYSE', 'ANALYSING', ...). SQLAlchemy's
# Enum type binds/reads by member name by default; using the lower-case
# values here would reject every write with an "invalid input value"
# error the moment the app tried to set a step.
planning_analysis_step = sa.Enum(
    'STRUCTURE', 'MOBILE', 'TECHNICAL', 'VISUAL', 'SUMMARY', name='planning_analysis_step'
)


def upgrade() -> None:
    # Real, observable checkpoints inside run_analysis_job — powers the
    # "During audit" progress list honestly instead of a timed guess.
    # Only meaningful while status is ANALYSING; cleared (NULL) once a
    # run finishes, one way or another.
    planning_analysis_step.create(op.get_bind(), checkfirst=True)
    op.add_column('lead_planning', sa.Column('current_step', planning_analysis_step, nullable=True))


def downgrade() -> None:
    op.drop_column('lead_planning', 'current_step')
    planning_analysis_step.drop(op.get_bind(), checkfirst=True)
