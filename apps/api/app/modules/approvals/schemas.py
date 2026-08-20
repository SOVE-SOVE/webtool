import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

ApprovalStage = Literal[
    "client_brief",
    "creative_direction",
    "sitemap",
    "generated_website",
    "qa",
    "client_review",
    "deployment",
]


class ApprovalCheckpoint(BaseModel):
    stage: ApprovalStage
    label: str
    approved: bool
    approved_by_user_name: str | None
    approved_at: datetime | None
    # A human-readable pointer to *what* was approved — a report/version
    # timestamp, since "preserve the approved version" means the
    # operator needs to be able to tell which one this was.
    version_label: str | None
    notes: str | None
    # Set only when `approved` is False, so the UI can explain why a
    # checkpoint can't be actioned yet instead of just greying it out.
    blocked_reason: str | None


class ProjectApprovalStatus(BaseModel):
    project_id: uuid.UUID
    checkpoints: list[ApprovalCheckpoint]
    can_deploy: bool
    missing_for_deployment: list[str]
