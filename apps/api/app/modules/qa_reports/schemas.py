import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class GenerateQaReportRequest(BaseModel):
    # A live, reachable URL for this exact website version. None until
    # a build/hosting step exists (roadmap M6) — see agents/technical_qa.py.
    preview_url: str | None = None


class QaCheckRead(BaseModel):
    category: Literal["performance", "responsiveness", "accessibility", "seo", "functionality", "security", "markup"]
    name: str
    status: Literal["pass", "fail", "warning", "skipped"]
    severity: Literal["critical", "high", "medium", "low", "info"]
    message: str
    recommended_fix: str | None
    location: str | None


class QaReportRead(BaseModel):
    id: uuid.UUID
    website_id: uuid.UUID
    kind: str
    passed: bool
    checks: list[QaCheckRead]
    passed_count: int
    failed_count: int
    warning_count: int
    skipped_count: int
    preview_url: str | None
    generated_by_user_id: uuid.UUID | None
    generated_by_user_name: str | None
    created_at: datetime

    human_approved: bool
    approved_by_user_name: str | None
    approved_at: datetime | None
    approval_notes: str | None


class QaReportSummary(BaseModel):
    id: uuid.UUID
    passed: bool
    passed_count: int
    failed_count: int
    warning_count: int
    skipped_count: int
    generated_by_user_name: str | None
    created_at: datetime
    human_approved: bool


class ApproveQaReportRequest(BaseModel):
    notes: str | None = None
