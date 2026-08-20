import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.agents import technical_qa
from app.modules.businesses.models import Business
from app.modules.clients.models import Client
from app.modules.design_briefs.models import DesignBrief
from app.modules.projects.models import Project
from app.modules.qa_reports.models import QaReport
from app.modules.qa_reports.schemas import GenerateQaReportRequest, QaReportRead, QaReportSummary
from app.modules.websites.models import Website

_READ_OPTIONS = (joinedload(QaReport.generated_by_user),)


def _get_website_in_workspace(db: Session, workspace_id: uuid.UUID, website_id: uuid.UUID) -> Website | None:
    return db.scalar(
        select(Website)
        .join(Project, Website.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id, Website.id == website_id)
    )


def _get_domain(db: Session, project_id: uuid.UUID) -> str | None:
    brief = db.scalar(select(DesignBrief).where(DesignBrief.project_id == project_id))
    return brief.domain if brief else None


def _build_qa_input(website: Website, domain: str | None, preview_url: str | None) -> technical_qa.TechnicalQaInput:
    config = website.config or {}
    return technical_qa.TechnicalQaInput(
        navigation=technical_qa.SectionInput(type=config["navigation"]["type"], config=config["navigation"]["config"]),
        footer=technical_qa.SectionInput(type=config["footer"]["type"], config=config["footer"]["config"]),
        pages=[
            technical_qa.PageInput(
                name=page["name"],
                slug=page["slug"],
                seo=technical_qa.PageSeoInput(**page["seo"]),
                sections=[technical_qa.SectionInput(type=s["type"], config=s["config"]) for s in page["sections"]],
            )
            for page in config.get("pages", [])
        ],
        domain=domain,
        preview_url=preview_url,
    )


def _summarize(output: technical_qa.TechnicalQaOutput) -> str:
    if output.ready_for_client_review:
        return f"Ready for client review — {output.passed_count} passed, {output.warning_count} warnings."
    critical = sum(1 for c in output.checks if c.status == "fail" and c.severity == "critical")
    return f"Not ready for client review — {critical} critical issue(s), {output.failed_count} failed checks total."


def run_qa(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, website_id: uuid.UUID, request: GenerateQaReportRequest
) -> QaReportRead | None:
    website = _get_website_in_workspace(db, workspace_id, website_id)
    if website is None:
        return None
    if not website.config:
        raise HTTPException(status_code=400, detail="This website version has no generated content to check yet")

    domain = _get_domain(db, website.project_id)
    qa_input = _build_qa_input(website, domain, request.preview_url)
    result = technical_qa.run(qa_input)
    output = result.output

    report = QaReport(
        website_id=website.id,
        kind="automated",
        passed=output.ready_for_client_review,
        summary=_summarize(output),
        report=output.model_dump(),
        preview_url=request.preview_url,
        generated_by_user_id=actor_id,
    )
    db.add(report)
    db.commit()
    return get_qa_report(db, workspace_id, report.id)


def _base_query(workspace_id: uuid.UUID):
    return (
        select(QaReport)
        .join(Website, QaReport.website_id == Website.id)
        .join(Project, Website.project_id == Project.id)
        .join(Client, Project.client_id == Client.id)
        .join(Business, Client.business_id == Business.id)
        .where(Business.workspace_id == workspace_id)
        .options(*_READ_OPTIONS)
    )


def list_qa_reports(db: Session, workspace_id: uuid.UUID, website_id: uuid.UUID) -> list[QaReportSummary]:
    reports = db.scalars(
        _base_query(workspace_id).where(QaReport.website_id == website_id).order_by(QaReport.created_at.desc())
    ).unique()
    return [
        QaReportSummary(
            id=r.id,
            passed=r.passed,
            passed_count=(r.report or {}).get("passed_count", 0),
            failed_count=(r.report or {}).get("failed_count", 0),
            warning_count=(r.report or {}).get("warning_count", 0),
            skipped_count=(r.report or {}).get("skipped_count", 0),
            generated_by_user_name=r.generated_by_user.name if r.generated_by_user else None,
            created_at=r.created_at,
        )
        for r in reports
    ]


def get_qa_report(db: Session, workspace_id: uuid.UUID, report_id: uuid.UUID) -> QaReportRead | None:
    r = db.scalar(_base_query(workspace_id).where(QaReport.id == report_id))
    if r is None or r.report is None:
        return None
    return QaReportRead(
        id=r.id,
        website_id=r.website_id,
        kind=r.kind,
        passed=r.passed,
        checks=r.report["checks"],
        passed_count=r.report["passed_count"],
        failed_count=r.report["failed_count"],
        warning_count=r.report["warning_count"],
        skipped_count=r.report["skipped_count"],
        preview_url=r.preview_url,
        generated_by_user_id=r.generated_by_user_id,
        generated_by_user_name=r.generated_by_user.name if r.generated_by_user else None,
        created_at=r.created_at,
    )
