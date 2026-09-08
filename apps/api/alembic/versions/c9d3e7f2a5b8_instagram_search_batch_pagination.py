"""instagram search batch pagination

Revision ID: c9d3e7f2a5b8
Revises: a4f8c2e6b1d3
Create Date: 2026-09-09 00:00:00.000000

Fixes Instagram Search Discovery returning only one (or very few)
candidates per run/"load more" click. Root cause: one `discover()` call
only ever fetched Brave's page-0 results (up to 20 raw results) for one
suburb's single, strictly double-quoted query, and "load more" advanced
straight to the *next suburb* rather than paging deeper into the
current one — see integrations/discovery/instagram_search_provider.py's
module docstring for the full explanation.

- `discovery_searches.next_suburb_index`: which suburb (index into
  `suburbs`) the next "load more" targets, once the current suburb's
  own pages are exhausted — the second axis of instagram_search's now
  two-dimensional pagination (suburb × page-within-suburb).
- `discovery_searches.pages_fetched`: a generic, provider-agnostic
  "load more" click counter (one per _ingest_page call) — replaces
  using `next_offset` for the MAX_PAGES_PER_SEARCH ceiling, since a
  single instagram_search page can itself cost multiple live Brave
  queries (fallback query widening) while still counting as one page.
- `discovery_searches.raw_results_checked`: how many raw Brave results
  have been examined so far, shown next to `result_count` (candidates
  actually created) so the operator sees "checked N, kept M".
- `discovery_search_cache.brave_offset` + a new unique constraint on
  (query_text, brave_offset), replacing the old unique-on-query_text-
  alone index: the same query text at a different Brave `offset` is a
  different API call returning different results, so it needs its own
  cache row rather than colliding with page 0's.

All additive/nullable-or-defaulted — a business or search from any
existing provider is unaffected.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d3e7f2a5b8"
down_revision: Union[str, None] = "a4f8c2e6b1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "discovery_searches",
        sa.Column("next_suburb_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "discovery_searches",
        sa.Column("pages_fetched", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "discovery_searches",
        sa.Column("raw_results_checked", sa.Integer(), nullable=False, server_default="0"),
    )

    op.add_column(
        "discovery_search_cache",
        sa.Column("brave_offset", sa.Integer(), nullable=False, server_default="0"),
    )
    op.drop_index("ix_discovery_search_cache_query_text", table_name="discovery_search_cache")
    op.create_index(
        "ix_discovery_search_cache_query_text", "discovery_search_cache", ["query_text"], unique=False
    )
    op.create_unique_constraint(
        "uq_discovery_search_cache_query_offset", "discovery_search_cache", ["query_text", "brave_offset"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_discovery_search_cache_query_offset", "discovery_search_cache", type_="unique")
    op.drop_index("ix_discovery_search_cache_query_text", table_name="discovery_search_cache")
    op.create_index(
        "ix_discovery_search_cache_query_text", "discovery_search_cache", ["query_text"], unique=True
    )
    op.drop_column("discovery_search_cache", "brave_offset")

    op.drop_column("discovery_searches", "raw_results_checked")
    op.drop_column("discovery_searches", "pages_fetched")
    op.drop_column("discovery_searches", "next_suburb_index")
