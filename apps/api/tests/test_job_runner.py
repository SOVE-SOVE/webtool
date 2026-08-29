"""
Unit-level coverage for the poller/handler wiring itself
(`app/jobs/runner.py` + `app/jobs/handlers.py`), separate from
`test_automation_pipeline.py`'s workflow-level walk — this file checks
the dispatch mechanism in isolation: every job_type the pipeline enqueues
has a registered handler, an unregistered job_type fails loudly instead
of silently doing nothing, and a handler that raises gets the same
retry-then-fail treatment `test_jobs.py` already proved the queue itself
provides.
"""

from app.jobs import runner
from app.jobs.handlers import HANDLERS
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import (
    JOB_BUSINESS_RESEARCH,
    JOB_DISCOVERY_SEARCH,
    JOB_FOLLOW_UP_DRAFT,
    JOB_OPPORTUNITY_SCORE,
    JOB_OUTREACH_DRAFT,
    JOB_QA_REPORT,
    JOB_WEBSITE_GENERATE,
    JOB_WEBSITE_QUALITY_AUDIT,
)
from app.modules.jobs.models import JobStatus


def test_every_pipeline_job_type_has_a_registered_handler():
    """Every job_type any service module in this pipeline enqueues must
    have a handler — an unregistered one is a job that will forever fail
    with "No handler registered" the moment it's claimed."""
    expected = {
        JOB_DISCOVERY_SEARCH,
        JOB_BUSINESS_RESEARCH,
        JOB_WEBSITE_QUALITY_AUDIT,
        JOB_OPPORTUNITY_SCORE,
        JOB_OUTREACH_DRAFT,
        JOB_FOLLOW_UP_DRAFT,
        JOB_WEBSITE_GENERATE,
        JOB_QA_REPORT,
    }
    assert expected <= HANDLERS.keys()


def test_run_once_returns_false_when_queue_empty(db_session, workspace):
    assert runner.run_once(HANDLERS) is False


def test_run_once_fails_unregistered_job_type_immediately(db_session, workspace):
    job = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="not_a_real_job_type", payload={})
    job.max_attempts = 1  # same "exhaust attempts" contract mark_failed already has — see test_jobs.py
    db_session.commit()

    claimed = runner.run_once(HANDLERS)
    assert claimed is True

    db_session.refresh(job)
    assert job.status == JobStatus.FAILED
    assert "No handler registered" in job.error_message
    assert "not_a_real_job_type" in job.error_message


def test_run_once_retries_then_fails_a_raising_handler(db_session, workspace, monkeypatch):
    def _raise(db, job):
        raise RuntimeError("simulated handler bug")

    monkeypatch.setitem(HANDLERS, "test_raising_job", _raise)
    job = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="test_raising_job", payload={})
    job.max_attempts = 1
    db_session.commit()

    assert runner.run_once(HANDLERS) is True

    db_session.refresh(job)
    assert job.status == JobStatus.FAILED
    assert "simulated handler bug" in job.error_message


def test_run_once_marks_a_successful_handler_done_with_its_result(db_session, workspace, monkeypatch):
    def _succeed(db, job):
        return {"ok": True}

    monkeypatch.setitem(HANDLERS, "test_succeeding_job", _succeed)
    job = jobs_service.enqueue(db_session, workspace_id=workspace.id, job_type="test_succeeding_job", payload={})

    assert runner.run_once(HANDLERS) is True

    db_session.refresh(job)
    assert job.status == JobStatus.DONE
    assert job.result == {"ok": True}
