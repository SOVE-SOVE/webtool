"""projects: build_direction

Revision ID: f2b7c1a9e3d4
Revises: e1a2b3c4d5f6
Create Date: 2026-09-04 23:15:00.000000

One nullable free-text column on `projects` for the build direction the
operator brings in from an outside ChatGPT/Claude session (concept,
visual direction, copy direction, page structure, generation prompts).
Optional — existing rows stay valid with null.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2b7c1a9e3d4"
down_revision: Union[str, None] = "e1a2b3c4d5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("build_direction", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "build_direction")
