"""performance: FK indexes on hot tenant-scoping and dashboard join paths

Revision ID: 5d66cd3a2217
Revises: ce37373d01d6
Create Date: 2026-08-27 00:00:00.000000

Postgres doesn't auto-index foreign key columns (only PK/unique ones),
and across this schema's 46 tables only a handful of FKs had ever been
explicitly indexed. `businesses.workspace_id` is the big one: every
tenant-scoping query in the app (every list/get endpoint, both
dashboards) reaches its workspace by following a FK chain up through
`businesses` (see app/modules/businesses/models.py's own docstring), so
this column being unindexed meant nearly every request forced a
sequential scan across all workspaces' businesses. The rest are FK
columns actually filtered/joined on a real, frequently-hit path (both
dashboards, the per-lead pipeline/interactions history tabs, discovery
review) per the phase 8 performance audit — not a blanket "index
everything" pass.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '5d66cd3a2217'
down_revision: Union[str, None] = 'ce37373d01d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES = [
    ("ix_businesses_workspace_id", "businesses", ["workspace_id"]),
    ("ix_activity_log_workspace_created", "activity_log", ["workspace_id", "created_at"]),
    ("ix_activity_log_entity", "activity_log", ["entity_type", "entity_id"]),
    ("ix_pipeline_events_lead_id", "pipeline_events", ["lead_id"]),
    ("ix_pipeline_events_project_id", "pipeline_events", ["project_id"]),
    ("ix_interactions_lead_id", "interactions", ["lead_id"]),
    ("ix_outreach_messages_lead_id", "outreach_messages", ["lead_id"]),
    ("ix_follow_ups_lead_id", "follow_ups", ["lead_id"]),
    ("ix_sales_opportunities_lead_id", "sales_opportunities", ["lead_id"]),
    ("ix_projects_client_id", "projects", ["client_id"]),
    ("ix_tasks_project_id", "tasks", ["project_id"]),
    ("ix_tasks_lead_id", "tasks", ["lead_id"]),
    ("ix_meetings_project_id", "meetings", ["project_id"]),
    ("ix_meetings_lead_id", "meetings", ["lead_id"]),
    ("ix_discovered_businesses_discovery_search_id", "discovered_businesses", ["discovery_search_id"]),
    ("ix_business_research_results_discovered_business_id", "business_research_results", ["discovered_business_id"]),
    ("ix_website_quality_audits_discovered_business_id", "website_quality_audits", ["discovered_business_id"]),
    ("ix_opportunity_score_results_discovered_business_id", "opportunity_score_results", ["discovered_business_id"]),
]


def upgrade() -> None:
    for name, table, columns in _INDEXES:
        op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
