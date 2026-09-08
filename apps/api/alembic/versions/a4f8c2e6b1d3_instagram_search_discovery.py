"""instagram search discovery (Phase 2)

Revision ID: a4f8c2e6b1d3
Revises: e3bc9d867dfb
Create Date: 2026-09-07 00:00:00.000000

Instagram Search Discovery (docs/05_DECISIONS.md): the automated,
site:instagram.com-search-based sibling of Phase 1's manual CSV import
(instagram_import.py) — see integrations/discovery/instagram_search_provider.py.

- `discovery_searches.suburbs`: the operator's suburb/city list for an
  instagram_search run (null for every other provider, which keeps using
  the existing `location` column).
- `discovery_searches.queries_used` / `.cache_hits`: live-query vs.
  cache-hit spend visibility (instagram_search only — 0 for everyone
  else).
- `discovered_businesses.instagram_website_checked_at`: when the manual
  "check for website" action last ran against this candidate (null if
  never).
- `discovered_businesses.raw_snippet`: the provider's result text,
  verbatim — was already collected by every provider
  (NormalizedBusinessResult.raw_snippet) but never persisted before this
  feature needed it for evidence retention; fixed at the shared
  ingestion layer, not just for instagram_search.
- `discovery_search_cache`: the 24h cache backing instagram_search's
  queries — see modules/discovery/search_cache.py.

All additive/nullable-or-defaulted — a business or search from any
existing provider is unaffected.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a4f8c2e6b1d3"
down_revision: Union[str, None] = "e3bc9d867dfb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("discovery_searches", sa.Column("suburbs", sa.JSON(), nullable=True))
    op.add_column(
        "discovery_searches",
        sa.Column("queries_used", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "discovery_searches",
        sa.Column("cache_hits", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "discovered_businesses",
        sa.Column("instagram_website_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("discovered_businesses", sa.Column("raw_snippet", sa.Text(), nullable=True))

    op.create_table(
        "discovery_search_cache",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("query_text", sa.String(length=1000), nullable=False),
        sa.Column("results_json", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_discovery_search_cache_query_text", "discovery_search_cache", ["query_text"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_discovery_search_cache_query_text", table_name="discovery_search_cache")
    op.drop_table("discovery_search_cache")

    op.drop_column("discovered_businesses", "raw_snippet")
    op.drop_column("discovered_businesses", "instagram_website_checked_at")
    op.drop_column("discovery_searches", "cache_hits")
    op.drop_column("discovery_searches", "queries_used")
    op.drop_column("discovery_searches", "suburbs")
