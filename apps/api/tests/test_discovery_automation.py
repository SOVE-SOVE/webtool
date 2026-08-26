"""
Phase 7 Task 2 — "Connect Lead Intelligence to the background job
system." Covers the `lead_discovery_batch` job handler and the
`/api/v1/discovery-schedules` CRUD the operator uses to configure
recurring discovery (location, industry, frequency, max leads, minimum
score). Provider network calls are stubbed the same way as
test_business_discovery.py.
"""

from app.integrations import search as search_integration
from app.integrations.search import SearchResult
from app.jobs import job_types
from app.modules.discovery import automation
from app.modules.discovery.schemas import LeadDiscoveryScheduleCreate, LeadDiscoveryScheduleUpdate
from app.modules.jobs import service as jobs_service
from app.modules.jobs.models import JobStatus, ScheduleFrequency


def _stub_results(n: int, monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query: [
            SearchResult(title=f"Co {i}", url=f"https://co{i}.example", description="") for i in range(n)
        ],
    )


def test_run_lead_discovery_batch_respects_max_leads(db_session, workspace, admin_user, monkeypatch):
    _stub_results(10, monkeypatch)

    job = jobs_service.enqueue(
        db_session,
        workspace_id=workspace.id,
        job_type=job_types.LEAD_DISCOVERY_BATCH,
        payload={"industry": "Plumbing", "location": "Gold Coast", "max_leads": 3},
        actor_id=admin_user.id,
    )

    result = automation.run_lead_discovery_batch(db_session, job)
    assert result["status"] == "completed"
    assert result["result_count"] == 3

    db_session.expire_all()
    refreshed = jobs_service.get_job(db_session, workspace.id, job.id)
    assert any("Searching" in entry["message"] for entry in refreshed.logs)


def test_run_lead_discovery_batch_without_actor_raises(db_session, workspace):
    job = jobs_service.enqueue(
        db_session,
        workspace_id=workspace.id,
        job_type=job_types.LEAD_DISCOVERY_BATCH,
        payload={"industry": "Plumbing"},
    )
    try:
        automation.run_lead_discovery_batch(db_session, job)
        assert False, "expected MisconfiguredScheduleError"
    except automation.MisconfiguredScheduleError:
        pass


def test_run_lead_discovery_batch_handles_provider_failure_gracefully(db_session, workspace, admin_user, monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query: None)

    job = jobs_service.enqueue(
        db_session,
        workspace_id=workspace.id,
        job_type=job_types.LEAD_DISCOVERY_BATCH,
        payload={"industry": "Plumbing"},
        actor_id=admin_user.id,
    )

    result = automation.run_lead_discovery_batch(db_session, job)
    assert result["status"] == "failed"
    assert result["error_message"]


def test_run_lead_discovery_batch_via_runner_marks_job_done(db_session, workspace, admin_user, monkeypatch):
    from app.jobs import runner

    _stub_results(2, monkeypatch)
    job = jobs_service.enqueue(
        db_session,
        workspace_id=workspace.id,
        job_type=job_types.LEAD_DISCOVERY_BATCH,
        payload={"industry": "Plumbing"},
        actor_id=admin_user.id,
    )

    claimed = runner.run_once({job_types.LEAD_DISCOVERY_BATCH: automation.run_lead_discovery_batch})
    assert claimed is True

    db_session.expire_all()
    refreshed = jobs_service.get_job(db_session, workspace.id, job.id)
    assert refreshed.status == JobStatus.DONE
    assert refreshed.result["result_count"] == 2


# --- Schedule service ------------------------------------------------------


def test_create_discovery_schedule_builds_payload(db_session, workspace, admin_user):
    schedule = automation.create_discovery_schedule(
        db_session,
        workspace.id,
        admin_user.id,
        LeadDiscoveryScheduleCreate(
            name="Morning discovery",
            location="Gold Coast",
            industry="Plumbing",
            max_leads=15,
            min_score=40,
            frequency=ScheduleFrequency.DAILY,
            run_at_hour=7,
        ),
    )
    assert schedule.job_type == job_types.LEAD_DISCOVERY_BATCH
    assert schedule.payload["location"] == "Gold Coast"
    assert schedule.payload["max_leads"] == 15
    assert schedule.payload["min_score"] == 40


def test_update_discovery_schedule_merges_payload(db_session, workspace, admin_user):
    schedule = automation.create_discovery_schedule(
        db_session,
        workspace.id,
        admin_user.id,
        LeadDiscoveryScheduleCreate(location="Gold Coast", industry="Plumbing", max_leads=15),
    )
    updated = automation.update_discovery_schedule(
        db_session, schedule, LeadDiscoveryScheduleUpdate(max_leads=25)
    )
    assert updated.payload["max_leads"] == 25
    assert updated.payload["location"] == "Gold Coast"  # untouched fields survive the merge


def test_get_discovery_schedule_ignores_other_job_types(db_session, workspace, admin_user):
    other = jobs_service.create_schedule(
        db_session,
        workspace_id=workspace.id,
        actor_id=admin_user.id,
        name=None,
        job_type="something_else",
        payload={},
        frequency=ScheduleFrequency.DAILY,
    )
    assert automation.get_discovery_schedule(db_session, workspace.id, other.id) is None


# --- Routes ------------------------------------------------------------------


def test_discovery_schedule_routes_crud(authed_client, other_authed_client):
    created = authed_client.post(
        "/api/v1/discovery-schedules",
        json={
            "name": "Morning discovery",
            "location": "Gold Coast",
            "industry": "Plumbing",
            "max_leads": 10,
            "min_score": 30,
            "frequency": "daily",
            "run_at_hour": 7,
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["location"] == "Gold Coast"
    assert body["max_leads"] == 10
    schedule_id = body["id"]

    assert [s["id"] for s in authed_client.get("/api/v1/discovery-schedules").json()] == [schedule_id]
    assert other_authed_client.get("/api/v1/discovery-schedules").json() == []
    assert other_authed_client.get(f"/api/v1/discovery-schedules/{schedule_id}").status_code == 404

    updated = authed_client.patch(f"/api/v1/discovery-schedules/{schedule_id}", json={"max_leads": 5})
    assert updated.status_code == 200
    assert updated.json()["max_leads"] == 5
    assert updated.json()["location"] == "Gold Coast"

    deleted = authed_client.delete(f"/api/v1/discovery-schedules/{schedule_id}")
    assert deleted.status_code == 204
    assert authed_client.get(f"/api/v1/discovery-schedules/{schedule_id}").status_code == 404


def test_discovery_schedule_run_now_enqueues_job(authed_client, monkeypatch):
    _stub_results(1, monkeypatch)
    created = authed_client.post(
        "/api/v1/discovery-schedules", json={"industry": "Plumbing", "frequency": "hourly", "interval_minutes": 60}
    )
    schedule_id = created.json()["id"]

    run_now = authed_client.post(f"/api/v1/discovery-schedules/{schedule_id}/run-now")
    assert run_now.status_code == 201
    assert run_now.json()["job_type"] == job_types.LEAD_DISCOVERY_BATCH

    jobs = authed_client.get(f"/api/v1/jobs?job_type={job_types.LEAD_DISCOVERY_BATCH}").json()
    assert len(jobs) == 1
