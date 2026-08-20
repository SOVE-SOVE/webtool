import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.db.session import get_db
from app.modules.qa_reports import service
from app.modules.qa_reports.schemas import (
    ApproveQaReportRequest,
    GenerateQaReportRequest,
    QaReportRead,
    QaReportSummary,
)
from app.modules.users.models import User
from app.modules.websites import service as websites_service

router = APIRouter(tags=["qa-reports"])

# No enforce_generation_rate_limit — agents/technical_qa.py makes no
# LLM call for its static checks; its live-preview checks drive a real
# browser directly (same pattern as website_audits, which also isn't
# rate-limited — only paid LLM-call routes are).


@router.post("/api/v1/websites/{website_id}/qa-reports", response_model=QaReportRead, status_code=201)
def generate_qa_report(
    website_id: uuid.UUID,
    body: GenerateQaReportRequest = GenerateQaReportRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QaReportRead:
    report = service.run_qa(db, current_user.workspace_id, current_user.id, website_id, body)
    if report is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return report


@router.get("/api/v1/websites/{website_id}/qa-reports", response_model=list[QaReportSummary])
def list_qa_reports(
    website_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[QaReportSummary]:
    if websites_service.get_website(db, current_user.workspace_id, website_id) is None:
        raise HTTPException(status_code=404, detail="Website not found")
    return service.list_qa_reports(db, current_user.workspace_id, website_id)


@router.get("/api/v1/qa-reports/{report_id}", response_model=QaReportRead)
def get_qa_report(
    report_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QaReportRead:
    report = service.get_qa_report(db, current_user.workspace_id, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="QA report not found")
    return report


@router.post("/api/v1/qa-reports/{report_id}/approve", response_model=QaReportRead)
def approve_qa_report(
    report_id: uuid.UUID,
    body: ApproveQaReportRequest = ApproveQaReportRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QaReportRead:
    report = service.approve_qa_report(db, current_user.workspace_id, current_user.id, report_id, body)
    if report is None:
        raise HTTPException(status_code=404, detail="QA report not found")
    return report
