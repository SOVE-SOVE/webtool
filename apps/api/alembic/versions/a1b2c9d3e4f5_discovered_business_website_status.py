"""discovered_businesses: website_status tri-state

Revision ID: a1b2c9d3e4f5
Revises: db927f4bf4fb
Create Date: 2026-08-31 12:00:00.000000

A business with no website is still a valid lead, so "does it have a
website" is a real tri-state (found / none / unknown), not "is
website_url null". Backfill: a row with a website_url has FOUND;
everything else is UNKNOWN (a plain web search can't confirm a business
has *no* site). See app/integrations/discovery/base.py::WebsiteStatus.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c9d3e4f5"
down_revision: Union[str, None] = "db927f4bf4fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# SQLAlchemy's Enum(PythonEnumClass) persists the member *name*
# (FOUND/NONE/UNKNOWN), matching discovered_business_status etc.
_website_status = sa.Enum("FOUND", "NONE", "UNKNOWN", name="discovered_business_website_status")


def upgrade() -> None:
    bind = op.get_bind()
    _website_status.create(bind)
    op.add_column(
        "discovered_businesses",
        sa.Column(
            "website_status",
            _website_status,
            nullable=False,
            server_default="UNKNOWN",
        ),
    )
    op.execute(
        "UPDATE discovered_businesses SET website_status = 'FOUND' "
        "WHERE website_url IS NOT NULL AND website_url <> ''"
    )


def downgrade() -> None:
    op.drop_column("discovered_businesses", "website_status")
    _website_status.drop(op.get_bind())
