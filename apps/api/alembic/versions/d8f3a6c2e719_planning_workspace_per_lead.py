"""planning workspace per lead

Revision ID: d8f3a6c2e719
Revises: c7e4a2f9b1d6
Create Date: 2026-09-10 00:00:00.000000

Splits "Start Planning" (open/create the workspace, no audit run) from
"Analyse Website" (the explicit trigger that actually enqueues the
background pipeline) — previously a single "Analyse Website" action on
the Lead did both at once. Two additive-safe schema changes on
`lead_planning`, no data loss:

- `lead_id` becomes UNIQUE: a lead now has at most one Planning
  workspace, re-analysed in place, rather than an append-only history
  of runs. Verified before writing this migration that no lead in the
  real database had more than one `lead_planning` row, so this adds
  cleanly with no conflicts.
- `website_url` becomes nullable: starting a workspace no longer
  requires a URL up front — a lead with none on record gets a bare
  workspace, and the operator enters one inside Planning before
  "Analyse Website" is enabled.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8f3a6c2e719'
down_revision: Union[str, None] = 'c7e4a2f9b1d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('lead_planning', 'website_url', existing_type=sa.String(length=500), nullable=True)
    op.create_unique_constraint('uq_lead_planning_lead_id', 'lead_planning', ['lead_id'])


def downgrade() -> None:
    op.drop_constraint('uq_lead_planning_lead_id', 'lead_planning', type_='unique')
    op.alter_column('lead_planning', 'website_url', existing_type=sa.String(length=500), nullable=False)
