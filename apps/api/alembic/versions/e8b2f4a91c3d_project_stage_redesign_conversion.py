"""project_stage redesign; source_lead_id, package, price_cents, deadline

Revision ID: e8b2f4a91c3d
Revises: d4a9e2f7c1b3
Create Date: 2026-08-19 09:00:00.000000

Backs the lead-to-client conversion workflow: converting a won lead now
creates a Project (not just a Client) in the same transaction, carrying
the agreed package/price/deadline and a direct traceability pointer
back to the originating lead (`source_lead_id`). Also replaces
`project_stage`'s value set with the pipeline the operator specified for
the workflow — see docs/05_DECISIONS.md for the full rationale and the
old->new stage mapping used below (existing project rows, if any, are
remapped rather than dropped).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e8b2f4a91c3d'
down_revision: Union[str, None] = 'd4a9e2f7c1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_STAGES = (
    'INTAKE', 'RESEARCH', 'BRIEF', 'DESIGN', 'DEVELOPMENT', 'QA',
    'CLIENT_REVIEW', 'REVISIONS', 'READY_TO_DEPLOY', 'DEPLOYED',
    'MAINTENANCE', 'COMPLETE',
)
OLD_STAGES = (
    'INTAKE', 'PROJECT', 'RESEARCH', 'DESIGN_BRIEF', 'SITEMAP', 'COPY',
    'WEBSITE', 'QA', 'MY_APPROVAL', 'CLIENT_APPROVAL', 'DEPLOYMENT',
    'MAINTENANCE',
)

# old stage name -> new stage name, applied via a SQL CASE during the
# column type swap in both directions.
OLD_TO_NEW = {
    'INTAKE': 'INTAKE',
    'PROJECT': 'INTAKE',
    'RESEARCH': 'RESEARCH',
    'DESIGN_BRIEF': 'BRIEF',
    'SITEMAP': 'DESIGN',
    'COPY': 'DESIGN',
    'WEBSITE': 'DEVELOPMENT',
    'QA': 'QA',
    'MY_APPROVAL': 'QA',
    'CLIENT_APPROVAL': 'CLIENT_REVIEW',
    'DEPLOYMENT': 'READY_TO_DEPLOY',
    'MAINTENANCE': 'MAINTENANCE',
}
NEW_TO_OLD = {
    'INTAKE': 'INTAKE',
    'RESEARCH': 'RESEARCH',
    'BRIEF': 'DESIGN_BRIEF',
    'DESIGN': 'SITEMAP',
    'DEVELOPMENT': 'WEBSITE',
    'QA': 'QA',
    'CLIENT_REVIEW': 'CLIENT_APPROVAL',
    'REVISIONS': 'CLIENT_APPROVAL',
    'READY_TO_DEPLOY': 'DEPLOYMENT',
    'DEPLOYED': 'DEPLOYMENT',
    'MAINTENANCE': 'MAINTENANCE',
    'COMPLETE': 'MAINTENANCE',
}


def _case_sql(column: str, mapping: dict[str, str]) -> str:
    whens = " ".join(f"WHEN '{old}' THEN '{new}'" for old, new in mapping.items())
    return f"CASE {column}::text {whens} END"


def upgrade() -> None:
    op.add_column('projects', sa.Column('source_lead_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'projects_source_lead_id_fkey', 'projects', 'leads', ['source_lead_id'], ['id'], ondelete='SET NULL'
    )
    op.add_column('projects', sa.Column('package', sa.String(length=50), nullable=True))
    op.add_column('projects', sa.Column('price_cents', sa.Integer(), nullable=True))
    op.add_column('projects', sa.Column('deadline', sa.Date(), nullable=True))

    new_enum = postgresql.ENUM(*NEW_STAGES, name='project_stage_new')
    new_enum.create(op.get_bind())
    op.execute(
        f"ALTER TABLE projects ALTER COLUMN stage TYPE project_stage_new "
        f"USING ({_case_sql('stage', OLD_TO_NEW)})::project_stage_new"
    )
    op.execute('DROP TYPE project_stage')
    op.execute('ALTER TYPE project_stage_new RENAME TO project_stage')


def downgrade() -> None:
    old_enum = postgresql.ENUM(*OLD_STAGES, name='project_stage_old')
    old_enum.create(op.get_bind())
    op.execute(
        f"ALTER TABLE projects ALTER COLUMN stage TYPE project_stage_old "
        f"USING ({_case_sql('stage', NEW_TO_OLD)})::project_stage_old"
    )
    op.execute('DROP TYPE project_stage')
    op.execute('ALTER TYPE project_stage_old RENAME TO project_stage')

    op.drop_constraint('projects_source_lead_id_fkey', 'projects', type_='foreignkey')
    op.drop_column('projects', 'deadline')
    op.drop_column('projects', 'price_cents')
    op.drop_column('projects', 'package')
    op.drop_column('projects', 'source_lead_id')
