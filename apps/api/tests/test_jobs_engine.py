"""
Phase 7 ("Automation Engine") — the generic background-job engine built
on top of M7's job queue: cancellation, structured logging, and
recurring schedules. Capability-specific automation (lead discovery,
prospect research) is covered in their own test modules.
"""

import uuid
from datetime import datetime, timedelta, timezone

from app.modules.jobs import service
from app.modules.jobs.models import Job, JobSchedule, JobStatus, ScheduleFrequency


def _enqueue(db_session, workspace, **overrides):
    defaults = dict(workspace_id=workspace.id, job_type="test_job", payload={"n": 1})
    defaults.update(overrides)
    return service.enqueue(db_session, **defaults)


def test_enqueue_and_claim_marks_running(db_session, workspace):
    job = _enqueue(db_session, workspace)
    assert job.status == JobStatus.PENDING
    assert job.attempts == 0

    claimed = service.claim_next(db_session)
    assert claimed.id == job.id
    assert claimed.status == JobStatus.RUNNING
    assert claimed.attempts == 1
    assert claimed.started_at is not None


def test_claim_next_ignores_future_run_after(db_session, workspace):
    _enqueue(db_session, workspace, run_after=datetime.now(timezone.utc) + timedelta(hours=1))
    assert service.claim_next(db_session) is None


def test_mark_done_sets_result(db_session, workspace):
    job = _enqueue(db_session, workspace)
    service.claim_next(db_session)
    done = service.mark_done(db_session, job, {"ok": True})
    assert done.status == JobStatus.DONE
    assert done.result == {"ok": True}
    assert done.completed_at is not None


def test_mark_failed_retries_until_max_attempts(db_session, workspace):
    job = _enqueue(db_session, workspace, max_attempts=2)
    service.claim_next(db_session)
    retried = service.mark_failed(db_session, job, "boom")
    assert retried.status == JobStatus.PENDING
    assert retried.error_message == "boom"

    service.claim_next(db_session)
    failed = service.mark_failed(db_session, job, "boom again")
    assert failed.status == JobStatus.FAILED
    assert failed.completed_at is not None


def test_cancel_pending_job_is_immediate(db_session, workspace):
    job = _enqueue(db_session, workspace)
    cancelled = service.request_cancel(db_session, workspace.id, job.id)
    assert cancelled.status == JobStatus.CANCELLED
    assert service.claim_next(db_session) is None


def test_cancel_running_job_only_sets_flag(db_session, workspace):
    job = _enqueue(db_session, workspace)
    service.claim_next(db_session)
    flagged = service.request_cancel(db_session, workspace.id, job.id)
    assert flagged.status == JobStatus.RUNNING
    assert flagged.cancel_requested is True
    assert service.is_cancel_requested(db_session, job.id) is True


def test_cancel_terminal_job_raises(db_session, workspace):
    job = _enqueue(db_session, workspace)
    service.claim_next(db_session)
    service.mark_done(db_session, job)
    try:
        service.request_cancel(db_session, workspace.id, job.id)
        assert False, "expected CannotCancelError"
    except service.CannotCancelError:
        pass


def test_cancel_unknown_job_returns_none(db_session, workspace):
    assert service.request_cancel(db_session, workspace.id, uuid.uuid4()) is None


def test_append_log_accumulates_entries(db_session, workspace):
    job = _enqueue(db_session, workspace)
    service.append_log(db_session, job, "started")
    updated = service.append_log(db_session, job, "step 2", level="warning")
    assert [entry["message"] for entry in updated.logs] == ["started", "step 2"]
    assert updated.logs[1]["level"] == "warning"


def test_list_jobs_filters_by_status_and_type(db_session, workspace):
    a = _enqueue(db_session, workspace, job_type="type_a")
    _enqueue(db_session, workspace, job_type="type_b")
    service.claim_next(db_session, job_type="type_a")

    assert [j.id for j in service.list_jobs(db_session, workspace.id, job_type="type_a")] == [a.id]
    assert len(service.list_jobs(db_session, workspace.id, status=JobStatus.RUNNING)) == 1
    assert len(service.list_jobs(db_session, workspace.id, status=JobStatus.PENDING)) == 1


def test_jobs_scoped_to_own_workspace(db_session, workspace, other_workspace):
    job = _enqueue(db_session, workspace)
    assert service.get_job(db_session, other_workspace.id, job.id) is None
    assert service.get_job(db_session, workspace.id, job.id).id == job.id


# --- Routes -------------------------------------------------------------


def test_job_routes_scoped_and_cancellable(authed_client, other_authed_client, db_session, workspace):
    job = _enqueue(db_session, workspace)

    listed = authed_client.get("/api/v1/jobs").json()
    assert [j["id"] for j in listed] == [str(job.id)]

    other_listed = other_authed_client.get("/api/v1/jobs").json()
    assert other_listed == []
    assert other_authed_client.get(f"/api/v1/jobs/{job.id}").status_code == 404

    fetched = authed_client.get(f"/api/v1/jobs/{job.id}")
    assert fetched.status_code == 200
    assert fetched.json()["status"] == "pending"

    cancelled = authed_client.post(f"/api/v1/jobs/{job.id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    again = authed_client.post(f"/api/v1/jobs/{job.id}/cancel")
    assert again.status_code == 400


def test_get_job_not_found(authed_client):
    res = authed_client.get(f"/api/v1/jobs/{uuid.uuid4()}")
    assert res.status_code == 404


# --- Scheduling math ------------------------------------------------------


def test_compute_next_run_at_daily_rolls_to_next_day_when_hour_passed():
    after = datetime(2026, 8, 26, 10, 0, tzinfo=timezone.utc)  # 10am, past the 7am target
    next_run = service.compute_next_run_at(
        ScheduleFrequency.DAILY, run_at_hour=7, day_of_week=None, interval_minutes=None, after=after
    )
    assert next_run == datetime(2026, 8, 27, 7, 0, tzinfo=timezone.utc)


def test_compute_next_run_at_daily_same_day_when_hour_not_reached():
    after = datetime(2026, 8, 26, 3, 0, tzinfo=timezone.utc)
    next_run = service.compute_next_run_at(
        ScheduleFrequency.DAILY, run_at_hour=7, day_of_week=None, interval_minutes=None, after=after
    )
    assert next_run == datetime(2026, 8, 26, 7, 0, tzinfo=timezone.utc)


def test_compute_next_run_at_weekly_picks_target_weekday():
    after = datetime(2026, 8, 26, 10, 0, tzinfo=timezone.utc)  # a Wednesday
    next_run = service.compute_next_run_at(
        ScheduleFrequency.WEEKLY, run_at_hour=7, day_of_week=0, interval_minutes=None, after=after  # Monday
    )
    assert next_run.weekday() == 0
    assert next_run.hour == 7
    assert next_run > after


def test_compute_next_run_at_hourly_uses_interval():
    after = datetime(2026, 8, 26, 10, 0, tzinfo=timezone.utc)
    next_run = service.compute_next_run_at(
        ScheduleFrequency.HOURLY, run_at_hour=7, day_of_week=None, interval_minutes=30, after=after
    )
    assert next_run == after + timedelta(minutes=30)


# --- Schedule CRUD + materialization --------------------------------------


def test_create_schedule_sets_next_run_at(db_session, workspace, admin_user):
    schedule = service.create_schedule(
        db_session,
        workspace_id=workspace.id,
        actor_id=admin_user.id,
        name="Morning discovery",
        job_type="test_job",
        payload={"foo": "bar"},
        frequency=ScheduleFrequency.DAILY,
        run_at_hour=7,
    )
    assert schedule.next_run_at is not None
    assert schedule.is_enabled is True


def test_materialize_due_schedules_enqueues_and_advances(db_session, workspace, admin_user):
    schedule = service.create_schedule(
        db_session,
        workspace_id=workspace.id,
        actor_id=admin_user.id,
        name=None,
        job_type="test_job",
        payload={"foo": "bar"},
        frequency=ScheduleFrequency.HOURLY,
        interval_minutes=60,
    )
    schedule.next_run_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    jobs = service.materialize_due_schedules(db_session)
    assert len(jobs) == 1
    assert jobs[0].job_type == "test_job"
    assert jobs[0].payload == {"foo": "bar"}

    db_session.refresh(schedule)
    assert schedule.last_job_id == jobs[0].id
    assert schedule.next_run_at > datetime.now(timezone.utc)

    # Not due again immediately.
    assert service.materialize_due_schedules(db_session) == []


def test_materialize_skips_disabled_schedules(db_session, workspace, admin_user):
    schedule = service.create_schedule(
        db_session,
        workspace_id=workspace.id,
        actor_id=admin_user.id,
        name=None,
        job_type="test_job",
        payload={},
        frequency=ScheduleFrequency.HOURLY,
    )
    schedule.next_run_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    schedule.is_enabled = False
    db_session.commit()

    assert service.materialize_due_schedules(db_session) == []


def test_run_schedule_now_does_not_disturb_cadence(db_session, workspace, admin_user):
    schedule = service.create_schedule(
        db_session,
        workspace_id=workspace.id,
        actor_id=admin_user.id,
        name=None,
        job_type="test_job",
        payload={},
        frequency=ScheduleFrequency.DAILY,
    )
    original_next_run_at = schedule.next_run_at
    job = service.run_schedule_now(db_session, schedule)
    assert job.status == JobStatus.PENDING
    db_session.refresh(schedule)
    assert schedule.next_run_at == original_next_run_at
    assert schedule.last_job_id == job.id


def test_schedule_routes_crud(authed_client, other_authed_client):
    created = authed_client.post(
        "/api/v1/job-schedules",
        json={
            "name": "Nightly report",
            "job_type": "test_job",
            "payload": {"x": 1},
            "frequency": "daily",
            "run_at_hour": 6,
        },
    )
    assert created.status_code == 201
    schedule_id = created.json()["id"]

    assert [s["id"] for s in authed_client.get("/api/v1/job-schedules").json()] == [schedule_id]
    assert other_authed_client.get("/api/v1/job-schedules").json() == []
    assert other_authed_client.get(f"/api/v1/job-schedules/{schedule_id}").status_code == 404

    updated = authed_client.patch(f"/api/v1/job-schedules/{schedule_id}", json={"is_enabled": False})
    assert updated.status_code == 200
    assert updated.json()["is_enabled"] is False

    run_now = authed_client.post(f"/api/v1/job-schedules/{schedule_id}/run-now")
    assert run_now.status_code == 201
    assert run_now.json()["job_type"] == "test_job"

    deleted = authed_client.delete(f"/api/v1/job-schedules/{schedule_id}")
    assert deleted.status_code == 204
    assert authed_client.get(f"/api/v1/job-schedules/{schedule_id}").status_code == 404


# --- Runner integration ----------------------------------------------------


def test_run_once_marks_cancelled_when_handler_raises_job_cancelled(db_session, workspace):
    from app.jobs import runner

    job = _enqueue(db_session, workspace)

    def handler(db, job):
        raise service.JobCancelled("stopped by request")

    claimed = runner.run_once({"test_job": handler})
    assert claimed is True

    # run_once used its own session (a separate connection) to commit the
    # update — db_session's identity map is holding a stale copy of `job`
    # until told to forget it.
    db_session.expire_all()
    refreshed = service.get_job(db_session, workspace.id, job.id)
    assert refreshed.status == JobStatus.CANCELLED
    assert refreshed.error_message == "stopped by request"


def test_run_once_marks_failed_on_unhandled_exception(db_session, workspace):
    from app.jobs import runner

    job = _enqueue(db_session, workspace, max_attempts=1)

    def handler(db, job):
        raise RuntimeError("kaboom")

    runner.run_once({"test_job": handler})
    db_session.expire_all()
    refreshed = service.get_job(db_session, workspace.id, job.id)
    assert refreshed.status == JobStatus.FAILED
    assert refreshed.error_message == "kaboom"


def test_run_once_unregistered_job_type_fails_without_retry_loop(db_session, workspace):
    from app.jobs import runner

    job = _enqueue(db_session, workspace, job_type="unknown_type")
    runner.run_once({})
    db_session.expire_all()
    refreshed = service.get_job(db_session, workspace.id, job.id)
    assert refreshed.status in (JobStatus.PENDING, JobStatus.FAILED)
    assert "No handler registered" in refreshed.error_message
