"""
The `lead_discovery_batch` job handler — Phase 7 Task 2, "Connect Lead
Intelligence to the background job system." A scheduled `JobSchedule`
(job_type=job_types.LEAD_DISCOVERY_BATCH, created via
`/api/v1/discovery-schedules`) materializes into one of these jobs per
configured cadence ("every morning", per the spec's example); this
handler just replays the same discover-and-dedup path the manual
`POST /discovery-searches` route already uses, capped at the operator's
configured `max_leads`.

Deliberately does NOT do research/analysis/scoring itself, and does NOT
touch review status or the CRM pipeline — `create_and_run_search`
already fans out a `prospect_research` job per newly discovered,
non-duplicate business (see app/modules/discovery/service.py and
app/modules/business_research/automation.py, Phase 7 Task 3), and the
existing `discovered_businesses` review queue (approve/reject/archive/
import) is the only path anything reaches the active sales pipeline —
this handler never calls it. Satisfies the spec's explicit "do not
automatically contact businesses" / "do not automatically add every
result to the active pipeline" constraints by simply not having any
code path that could.
"""

import uuid

from sqlalchemy.orm import Session

from app.jobs import job_types
from app.modules.discovery import service as discovery_service
from app.modules.discovery.schemas import (
    DiscoverySearchCreate,
    LeadDiscoveryScheduleCreate,
    LeadDiscoveryScheduleUpdate,
)
from app.modules.jobs import service as jobs_service
from app.modules.jobs.models import Job, JobSchedule

DEFAULT_MAX_LEADS = 20


def _schedule_payload(data: LeadDiscoveryScheduleCreate | LeadDiscoveryScheduleUpdate, base: dict | None = None) -> dict:
    payload = dict(base or {})
    for key in (
        "query_label",
        "location",
        "industry",
        "business_type",
        "keywords",
        "provider",
        "max_leads",
        "min_score",
    ):
        value = getattr(data, key)
        if value is not None:
            payload[key] = value
    return payload


def create_discovery_schedule(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, data: LeadDiscoveryScheduleCreate
) -> JobSchedule:
    return jobs_service.create_schedule(
        db,
        workspace_id=workspace_id,
        actor_id=actor_id,
        name=data.name,
        job_type=job_types.LEAD_DISCOVERY_BATCH,
        payload=_schedule_payload(data),
        frequency=data.frequency,
        run_at_hour=data.run_at_hour,
        day_of_week=data.day_of_week,
        interval_minutes=data.interval_minutes,
    )


def list_discovery_schedules(db: Session, workspace_id: uuid.UUID) -> list[JobSchedule]:
    return jobs_service.list_schedules(db, workspace_id, job_type=job_types.LEAD_DISCOVERY_BATCH)


def get_discovery_schedule(db: Session, workspace_id: uuid.UUID, schedule_id: uuid.UUID) -> JobSchedule | None:
    schedule = jobs_service.get_schedule(db, workspace_id, schedule_id)
    if schedule is None or schedule.job_type != job_types.LEAD_DISCOVERY_BATCH:
        return None
    return schedule


def update_discovery_schedule(db: Session, schedule: JobSchedule, data: LeadDiscoveryScheduleUpdate) -> JobSchedule:
    return jobs_service.update_schedule(
        db,
        schedule,
        name=data.name,
        payload=_schedule_payload(data, base=schedule.payload),
        frequency=data.frequency,
        run_at_hour=data.run_at_hour,
        day_of_week=data.day_of_week,
        interval_minutes=data.interval_minutes,
        is_enabled=data.is_enabled,
    )


class MisconfiguredScheduleError(ValueError):
    """Raised when a lead_discovery_batch job has no actor to run as —
    only possible if a JobSchedule row was created without an operator,
    which the API never allows."""


def run_lead_discovery_batch(db: Session, job: Job) -> dict:
    if job.created_by_user_id is None:
        raise MisconfiguredScheduleError("lead_discovery_batch job has no created_by_user_id to act as")

    payload = job.payload
    max_leads = int(payload.get("max_leads") or DEFAULT_MAX_LEADS)

    data = DiscoverySearchCreate(
        query_label=payload.get("query_label"),
        location=payload.get("location"),
        industry=payload.get("industry"),
        business_type=payload.get("business_type"),
        keywords=payload.get("keywords"),
        min_score=payload.get("min_score"),
        provider=payload.get("provider"),
    )

    if jobs_service.is_cancel_requested(db, job.id):
        raise jobs_service.JobCancelled("cancelled before the search started")

    jobs_service.append_log(
        db, job, f"Searching for {data.industry or 'any industry'} in {data.location or 'any location'}"
    )

    search = discovery_service.create_and_run_search(
        db, job.workspace_id, job.created_by_user_id, data, max_results=max_leads
    )

    jobs_service.append_log(
        db, job, f"Discovery search {search.status.value}: {search.result_count} result(s), max_leads={max_leads}"
    )

    return {
        "discovery_search_id": str(search.id),
        "status": search.status.value,
        "result_count": search.result_count,
        "error_message": search.error_message,
    }
