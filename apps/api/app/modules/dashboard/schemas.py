import uuid

from pydantic import BaseModel


class AttentionItem(BaseModel):
    """
    One row of "what should I do next". `action` is the imperative next
    step — the thing the operator actually does — and `href` goes to the
    exact screen where they do it, not just the section index.
    """

    kind: str
    label: str  # short badge text, e.g. "QA", "Follow-up", "Deploy"
    id: uuid.UUID
    title: str  # who/what it's about — business or project name
    detail: str  # why it's on the list
    action: str
    href: str


class WebsitePipeline(BaseModel):
    """How many client sites sit at each delivery stage — bucketed from
    Project.stage (see modules/dashboard/service.py)."""

    building: int  # intake → development
    in_review: int  # QA / client review / revisions
    ready_to_launch: int  # ready_to_deploy
    deployed: int
    maintenance: int


class DashboardOverview(BaseModel):
    total_leads: int
    qualified_leads: int
    contacted_leads: int
    upcoming_meetings: int
    won_projects: int
    active_projects: int
    websites: WebsitePipeline
    revenue_cents: int
    tasks_needing_attention: int
    follow_ups_due: int
    needs_attention: list[AttentionItem]
