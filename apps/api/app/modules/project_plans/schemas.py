import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.modules.project_plans.models import PlanStageStatus
from app.modules.projects.models import ProjectStage


class PlanStageUpdate(BaseModel):
    label: str | None = None
    due_at: date | None = None
    requires_approval: bool | None = None
    status: PlanStageStatus | None = None
    # See leads/schemas.py's LeadUpdate for why this stays a plain
    # optional field: the key must be present at all to change
    # responsibility, `null` clears it.
    responsible_user_id: uuid.UUID | None = None


class PlanStageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    stage: ProjectStage
    label: str
    sort_order: int
    responsible_user_id: uuid.UUID | None
    responsible_user_name: str | None
    due_at: date | None
    requires_approval: bool
    status: PlanStageStatus
    approved: bool
    approved_by_user_id: uuid.UUID | None
    approved_by_user_name: str | None
    approved_at: datetime | None
    task_count: int
    tasks_done: int


class ProjectPlanRead(BaseModel):
    project_id: uuid.UUID
    stages: list[PlanStageRead]
