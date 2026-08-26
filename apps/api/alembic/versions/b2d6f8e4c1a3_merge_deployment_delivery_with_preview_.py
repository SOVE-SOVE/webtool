"""merge deployment/delivery workflow with preview/feedback/approval workflow branches

Revision ID: b2d6f8e4c1a3
Revises: a9e3c7f1d8b2, 6742373b79d7
Create Date: 2026-08-26 00:20:00.000000

Both branches fork from 731a8a798e83 — phase 6 part 2 (deployment
adapter architecture + delivery workflow, this branch) and phase 6
(previews/feedback/approval workflow, merged to main first) were
developed concurrently in separate worktrees. No schema overlap between
them (one touches `deployments`/`projects`, the other adds new
`preview_links`/`website_feedback` tables and `websites` workflow
columns), so this is a pure merge point, same shape as the existing
731a8a798e83 merge migration.
"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'b2d6f8e4c1a3'
down_revision: Union[str, None] = ('a9e3c7f1d8b2', '6742373b79d7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
