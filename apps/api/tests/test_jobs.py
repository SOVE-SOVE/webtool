"""
The background-work queue designed in docs/02_ARCHITECTURE.md §4 but
built for the first time as part of the Lead Intelligence architecture
— exercises enqueue/claim/complete/fail directly against the service
layer (no routes exist for this yet; nothing user-facing enqueues a job
in this pass).
"""

from datetime import datetime, timedelta, timezone

from app.modules.jobs import service as jobs_service
from app.modules.jobs.models import JobStatus


def test_enqueue_creates_pending_job(db_session, workspace):
    job = jobs_service.enqueue(
        db_session, workspace_id=workspace.id, job_type="discovery_search", payload={"search_id": "abc"}
    )
    assert job.status == JobStatus.PENDING
    assert job.payload == {"search_id": "abc"}
    assert job.attempts == 0


def test_claim_next_returns_due_job_and_marks_running(db_session, workspace):
    job = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="discovery_search", payload={})

    claimed = jobs_service.claim_next(db_session)

    assert claimed is not None
    assert claimed.id == job.id
    assert claimed.status == JobStatus.RUNNING
    assert claimed.attempts == 1
    assert claimed.started_at is not None


def test_claim_next_skips_future_run_after(db_session, workspace):
    jobs_service.enqueue(
        db_session,
        workspace_id=workspace.id,
        job_type="discovery_search",
        payload={},
        run_after=datetime.now(timezone.utc) + timedelta(hours=1),
    )

    assert jobs_service.claim_next(db_session) is None


def test_claim_next_filters_by_job_type(db_session, workspace):
    jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="other_type", payload={})

    assert jobs_service.claim_next(db_session, job_type="discovery_search") is None

    matching = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="discovery_search", payload={})
    claimed = jobs_service.claim_next(db_session, job_type="discovery_search")
    assert claimed.id == matching.id


def test_claim_next_ignores_already_running_job(db_session, workspace):
    jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="discovery_search", payload={})
    jobs_service.claim_next(db_session)  # claims the only pending job

    assert jobs_service.claim_next(db_session) is None


def test_mark_done_records_result(db_session, workspace):
    job = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="discovery_search", payload={})
    claimed = jobs_service.claim_next(db_session)

    done = jobs_service.mark_done(db_session, claimed, result={"found": 5})

    assert done.status == JobStatus.DONE
    assert done.result == {"found": 5}
    assert done.completed_at is not None


def test_mark_failed_retries_until_max_attempts(db_session, workspace):
    job = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="discovery_search", payload={})
    job.max_attempts = 2
    db_session.commit()

    claimed = jobs_service.claim_next(db_session)  # attempts=1
    failed_once = jobs_service.mark_failed(db_session, claimed, "provider timeout")
    assert failed_once.status == JobStatus.PENDING  # still has attempts left

    claimed_again = jobs_service.claim_next(db_session)  # attempts=2
    assert claimed_again.id == job.id
    failed_again = jobs_service.mark_failed(db_session, claimed_again, "provider timeout again")
    assert failed_again.status == JobStatus.FAILED
    assert failed_again.completed_at is not None


def test_list_jobs_scoped_to_workspace(db_session, workspace, other_workspace):
    mine = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="discovery_search", payload={})
    jobs_service.enqueue(db_session, workspace_id=other_workspace.id, job_type="discovery_search", payload={})

    jobs = jobs_service.list_jobs(db_session, workspace.id)

    assert [j.id for j in jobs] == [mine.id]


def test_get_job_not_found_in_other_workspace(db_session, workspace, other_workspace):
    job = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="discovery_search", payload={})

    assert jobs_service.get_job(db_session, other_workspace.id, job.id) is None
    assert jobs_service.get_job(db_session, workspace.id, job.id) is not None
