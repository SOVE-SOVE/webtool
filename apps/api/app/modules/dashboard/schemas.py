import uuid

from pydantic import BaseModel


class AttentionItem(BaseModel):
    kind: str  # "task" | "stale_lead"
    id: uuid.UUID
    title: str
    detail: str
    href: str


class DashboardOverview(BaseModel):
    total_leads: int
    qualified_leads: int
    contacted_leads: int
    meetings: int
    won_projects: int
    active_projects: int
    revenue_cents: int
    tasks_needing_attention: int
    needs_attention: list[AttentionItem]
