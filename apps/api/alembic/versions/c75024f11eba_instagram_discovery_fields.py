"""instagram discovery fields (Phase 1)

Revision ID: c75024f11eba
Revises: f2b7c1a9e3d4
Create Date: 2026-09-05 00:00:00.000000

Phase 1 of Instagram Discovery (docs/05_DECISIONS.md): nullable
Instagram-only columns on `discovered_businesses`, plus two new enum
types — `instagram_website_status` (a finer classification than the
existing tri-state `discovered_business_website_status`, specific to a
business primarily operating through Instagram — see
app/integrations/discovery/base.py::InstagramWebsiteStatus) and
`location_confidence` (how much to trust the location fields on any
candidate, not just Instagram-sourced ones). All additive/nullable — a
business found via Brave Search or Google Places simply leaves every
new column null, exactly as before this migration.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c75024f11eba"
down_revision: Union[str, None] = "f2b7c1a9e3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# SQLAlchemy's Enum(PythonEnumClass) persists the member *name*, matching
# the existing discovered_business_website_status/discovered_business_status
# convention (see a1b2c9d3e4f5_discovered_businesses_website_status_tri_state.py).
_instagram_website_status = sa.Enum(
    "NO_WEBSITE",
    "LINK_IN_BIO_ONLY",
    "INSTAGRAM_SHOP_ONLY",
    "PROPER_WEBSITE",
    "UNKNOWN_NEEDS_REVIEW",
    name="instagram_website_status",
)
_location_confidence = sa.Enum("CONFIRMED", "APPROXIMATE", "UNKNOWN", name="location_confidence")


def upgrade() -> None:
    bind = op.get_bind()
    _location_confidence.create(bind)
    _instagram_website_status.create(bind)

    op.add_column("discovered_businesses", sa.Column("location_confidence", _location_confidence, nullable=True))

    op.add_column("discovered_businesses", sa.Column("instagram_handle", sa.String(length=100), nullable=True))
    op.add_column(
        "discovered_businesses", sa.Column("instagram_profile_url", sa.String(length=500), nullable=True)
    )
    op.add_column(
        "discovered_businesses", sa.Column("instagram_profile_image_url", sa.String(length=500), nullable=True)
    )
    op.add_column("discovered_businesses", sa.Column("instagram_bio", sa.Text(), nullable=True))
    op.add_column(
        "discovered_businesses", sa.Column("instagram_follower_count", sa.Integer(), nullable=True)
    )
    op.add_column(
        "discovered_businesses",
        sa.Column("instagram_last_post_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "discovered_businesses", sa.Column("instagram_bio_link_url", sa.String(length=500), nullable=True)
    )
    op.add_column(
        "discovered_businesses",
        sa.Column("instagram_website_status", _instagram_website_status, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("discovered_businesses", "instagram_website_status")
    op.drop_column("discovered_businesses", "instagram_bio_link_url")
    op.drop_column("discovered_businesses", "instagram_last_post_at")
    op.drop_column("discovered_businesses", "instagram_follower_count")
    op.drop_column("discovered_businesses", "instagram_bio")
    op.drop_column("discovered_businesses", "instagram_profile_image_url")
    op.drop_column("discovered_businesses", "instagram_profile_url")
    op.drop_column("discovered_businesses", "instagram_handle")
    op.drop_column("discovered_businesses", "location_confidence")

    _instagram_website_status.drop(op.get_bind())
    _location_confidence.drop(op.get_bind())
