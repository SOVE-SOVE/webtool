"""
job_type -> handler registry for app/jobs/runner.py, per
docs/03_AGENT_RULES.md's "can proceed autonomously" list. Registering a
handler here plus an `enqueue` call at the upstream completion point
(see the service modules this imports) is what turns a manual,
button-click pipeline stage into one that runs on its own.

Every handler below is safe to run unattended: research, a website
quality/technical audit, opportunity/lead scoring, drafting outreach or
a follow-up, generating a website, running QA. Nothing here ever sends
outreach, imports a discovered business into the CRM, wins/closes a
deal, approves website content, or executes a deployment — those stay
behind an explicit operator action (docs/03_AGENT_RULES.md "always
requires human review"), untouched by this module.

A handler's job is to call the same service function the equivalent
manual route calls, then enqueue whatever comes next — so a job-
triggered run and an operator clicking "Generate" produce identical
rows and identical downstream automation.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.discovery import service as discovery_service
from app.modules.discovery.schemas import DiscoverySearchCreate
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import (
    DEFAULT_DISCOVERY_INTERVAL_HOURS,
    JOB_BUSINESS_RESEARCH,
    JOB_DISCOVERY_SEARCH,
    JOB_FOLLOW_UP_DRAFT,
    JOB_OPPORTUNITY_SCORE,
    JOB_OUTREACH_DRAFT,
    JOB_QA_REPORT,
    JOB_REVIEW_INTELLIGENCE,
    JOB_WEBSITE_GENERATE,
    JOB_WEBSITE_QUALITY_AUDIT,
)
from app.modules.jobs.models import Job


def handle_discovery_search(db: Session, job: Job) -> dict:
    """
    Runs a discovery search from a job payload — same criteria shape as
    `DiscoverySearchCreate`, plus the auto-chain: `create_and_run_search`
    itself enqueues a `business_research` job for every newly discovered
    business, so a scheduled run flows straight into research -> audit ->
    score with no further wiring here.

    When `payload["recurring"]` is true, reschedules itself
    `interval_hours` (default `DEFAULT_DISCOVERY_INTERVAL_HOURS`) from
    now — the "scheduled discovery" requirement, using the job queue's
    own `run_after` rather than a separate cron/scheduler process, per
    the design note on `Job.run_after`.
    """
    payload = job.payload
    data = DiscoverySearchCreate(
        query_label=payload.get("query_label"),
        location=payload.get("location"),
        industry=payload.get("industry"),
        business_type=payload.get("business_type"),
        keywords=payload.get("keywords"),
        min_score=payload.get("min_score"),
        max_score=payload.get("max_score"),
        has_website=payload.get("has_website"),
        website_outdated=payload.get("website_outdated"),
        provider=payload.get("provider"),
    )

    try:
        result = discovery_service.create_and_run_search(db, job.workspace_id, job.created_by_user_id, data)
    finally:
        # Reschedule even if the run itself failed (e.g. a provider
        # outage) — a recurring search must not silently die the first
        # time a provider call errors; it just tries again next cycle.
        if payload.get("recurring"):
            interval_hours = payload.get("interval_hours") or DEFAULT_DISCOVERY_INTERVAL_HOURS
            jobs_service.enqueue(
                db,
                workspace_id=job.workspace_id,
                job_type=JOB_DISCOVERY_SEARCH,
                payload=payload,
                actor_id=job.created_by_user_id,
                run_after=datetime.now(timezone.utc) + timedelta(hours=interval_hours),
            )

    return {"discovery_search_id": str(result.id), "result_count": result.result_count, "status": result.status.value}


def handle_business_research(db: Session, job: Job) -> dict:
    from app.modules.business_research import service as business_research_service

    business_id = uuid.UUID(job.payload["discovered_business_id"])
    result = business_research_service.run_research(db, job.workspace_id, job.created_by_user_id, business_id)
    return {"discovered_business_id": str(business_id), "researched": result is not None}


def handle_review_intelligence(db: Session, job: Job) -> dict:
    from app.modules.review_intelligence import service as review_intelligence_service

    business_id = uuid.UUID(job.payload["discovered_business_id"])
    result = review_intelligence_service.run_review_intelligence(
        db, job.workspace_id, job.created_by_user_id, business_id
    )
    return {
        "discovered_business_id": str(business_id),
        "data_status": result.data_status.value if result else None,
    }


def handle_website_quality_audit(db: Session, job: Job) -> dict:
    from app.modules.website_quality import service as website_quality_service

    business_id = uuid.UUID(job.payload["discovered_business_id"])
    try:
        result = website_quality_service.run_quality_audit(db, job.workspace_id, job.created_by_user_id, business_id)
    except website_quality_service.NoResearchAvailableError as exc:
        # Research hasn't landed yet (shouldn't happen via the normal
        # chain, since this job is only ever enqueued after research
        # succeeds) — surfaced as a job failure so it retries rather
        # than silently doing nothing.
        raise RuntimeError(str(exc)) from exc
    return {"discovered_business_id": str(business_id), "audited": result is not None}


def handle_opportunity_score(db: Session, job: Job) -> dict:
    from app.modules.opportunity_scoring import service as opportunity_scoring_service

    business_id = uuid.UUID(job.payload["discovered_business_id"])
    try:
        result = opportunity_scoring_service.run_opportunity_score(
            db, job.workspace_id, job.created_by_user_id, business_id
        )
    except opportunity_scoring_service.NoResearchAvailableError as exc:
        raise RuntimeError(str(exc)) from exc
    return {
        "discovered_business_id": str(business_id),
        "scored": result is not None,
        "category": result.category.value if result else None,
    }


def handle_outreach_draft(db: Session, job: Job) -> dict:
    from app.modules.outreach import service as outreach_service
    from app.modules.outreach.models import OutreachChannel

    lead_id = uuid.UUID(job.payload["lead_id"])

    # Guards here, not just at the enqueue site in sales_audits/service.py
    # — re-generating a lead's sales audit enqueues this job again every
    # time, so the check has to hold even if two such jobs are ever
    # pending for the same lead at once.
    if outreach_service.list_outreach(db, job.workspace_id, lead_id):
        return {"lead_id": str(lead_id), "outreach_id": None, "skipped": "outreach already exists for this lead"}

    channel = OutreachChannel(job.payload.get("channel", "email"))
    result = outreach_service.generate_outreach(db, job.workspace_id, job.created_by_user_id, lead_id, channel)
    return {"lead_id": str(lead_id), "outreach_id": str(result.id) if result else None}


def handle_follow_up_draft(db: Session, job: Job) -> dict:
    from app.modules.outreach import service as outreach_service

    lead_id = uuid.UUID(job.payload["lead_id"])
    result = outreach_service.generate_follow_up(db, job.workspace_id, job.created_by_user_id, lead_id)
    return {"lead_id": str(lead_id), "follow_up_id": str(result.id) if result else None}


def handle_website_generate(db: Session, job: Job) -> dict:
    from app.modules.websites import service as websites_service
    from app.modules.websites.schemas import GenerateWebsiteRequest

    project_id = uuid.UUID(job.payload["project_id"])
    result = websites_service.generate_website(
        db, job.workspace_id, job.created_by_user_id, project_id, GenerateWebsiteRequest()
    )
    return {"project_id": str(project_id), "website_id": str(result.id) if result else None}


def handle_qa_report(db: Session, job: Job) -> dict:
    from app.modules.qa_reports import service as qa_reports_service
    from app.modules.qa_reports.schemas import GenerateQaReportRequest

    website_id = uuid.UUID(job.payload["website_id"])
    result = qa_reports_service.run_qa(
        db, job.workspace_id, job.created_by_user_id, website_id, GenerateQaReportRequest()
    )
    return {
        "website_id": str(website_id),
        "qa_report_id": str(result.id) if result else None,
        "passed": result.passed if result else None,
    }


HANDLERS = {
    JOB_DISCOVERY_SEARCH: handle_discovery_search,
    JOB_BUSINESS_RESEARCH: handle_business_research,
    JOB_REVIEW_INTELLIGENCE: handle_review_intelligence,
    JOB_WEBSITE_QUALITY_AUDIT: handle_website_quality_audit,
    JOB_OPPORTUNITY_SCORE: handle_opportunity_score,
    JOB_OUTREACH_DRAFT: handle_outreach_draft,
    JOB_FOLLOW_UP_DRAFT: handle_follow_up_draft,
    JOB_WEBSITE_GENERATE: handle_website_generate,
    JOB_QA_REPORT: handle_qa_report,
}
