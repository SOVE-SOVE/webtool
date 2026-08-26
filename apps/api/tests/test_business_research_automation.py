"""
Phase 7 Task 3 — "Build scheduled website research." Covers the
`prospect_research` job handler (research -> quality analysis ->
scoring, cooperative cancellation, graceful provider-failure handling,
min_score auto-archive) and its automatic enqueue from
discovery/service.py::create_and_run_search for every newly discovered,
non-duplicate business.
"""

from app.integrations import search as search_integration
from app.integrations.browser import ResearchPageSignals
from app.integrations.search import SearchResult
from app.jobs import job_types
from app.modules.business_research import automation
from app.modules.business_research.models import BusinessResearchResult
from app.modules.businesses.models import Business
from app.modules.discovery.models import DiscoveredBusiness, DiscoveredBusinessStatus, DiscoverySearch
from app.modules.jobs import service as jobs_service
from app.modules.jobs.models import JobStatus


def _make_search(db_session, workspace, **overrides) -> DiscoverySearch:
    defaults = dict(workspace_id=workspace.id, industry="Plumbing", provider="manual")
    defaults.update(overrides)
    search = DiscoverySearch(**defaults)
    db_session.add(search)
    db_session.commit()
    db_session.refresh(search)
    return search


def _make_discovered_business(db_session, search, **overrides) -> DiscoveredBusiness:
    defaults = dict(
        discovery_search_id=search.id,
        name="Gold Coast Plumbing Co",
        website_url="https://gcplumbing.example",
        source_provider="manual",
        dedup_key="gold coast plumbing co||",
    )
    defaults.update(overrides)
    business = DiscoveredBusiness(**defaults)
    db_session.add(business)
    db_session.commit()
    db_session.refresh(business)
    return business


def _patch_full_signals(monkeypatch, **overrides):
    kwargs = dict(
        final_url="https://gcplumbing.example",
        https=True,
        http_status=200,
        title="Gold Coast Plumbing Co",
        meta_description="Local plumbers",
        viewport_meta_present=True,
        mobile_overflow=False,
        contact_cta_present=True,
        social_links=["https://facebook.com/gcplumbing"],
        body_text="Copyright 2022 Gold Coast Plumbing Co",
    )
    kwargs.update(overrides)

    async def fake_fetch(url):
        return ResearchPageSignals(**kwargs)

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)


def _enqueue_research_job(db_session, workspace, business, actor_id=None):
    return jobs_service.enqueue(
        db_session,
        workspace_id=workspace.id,
        job_type=job_types.PROSPECT_RESEARCH,
        payload={"discovered_business_id": str(business.id)},
        actor_id=actor_id,
    )


# --- Handler: happy path -----------------------------------------------------


def test_run_prospect_research_full_pipeline(db_session, workspace, admin_user, monkeypatch):
    _patch_full_signals(monkeypatch)
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)
    job = _enqueue_research_job(db_session, workspace, business, admin_user.id)

    result = automation.run_prospect_research(db_session, job)

    assert result["research_error"] is None
    assert result["confidence"] == 0.85
    assert "opportunity_score" in result
    assert "quality_issue_count" in result

    db_session.refresh(business)
    assert business.status == DiscoveredBusinessStatus.SCORED

    research = db_session.query(BusinessResearchResult).filter_by(discovered_business_id=business.id).one()
    assert research.provider == "browser"
    assert research.confidence == 0.85


def test_run_prospect_research_missing_business_is_skipped(db_session, workspace, admin_user):
    import uuid

    job = jobs_service.enqueue(
        db_session,
        workspace_id=workspace.id,
        job_type=job_types.PROSPECT_RESEARCH,
        payload={"discovered_business_id": str(uuid.uuid4())},
        actor_id=admin_user.id,
    )
    result = automation.run_prospect_research(db_session, job)
    assert "skipped" in result


def test_run_prospect_research_handles_unreachable_site_gracefully(db_session, workspace, admin_user, monkeypatch):
    async def fake_fetch(url):
        return ResearchPageSignals(error="net::ERR_CONNECTION_REFUSED")

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)
    job = _enqueue_research_job(db_session, workspace, business, admin_user.id)

    result = automation.run_prospect_research(db_session, job)

    assert result["research_error"] == "net::ERR_CONNECTION_REFUSED"
    # The pipeline keeps going past a research failure — quality/score
    # still ran against the degraded signal instead of aborting the job.
    assert "opportunity_score" in result

    db_session.refresh(business)
    assert business.status != DiscoveredBusinessStatus.NEW


# --- Cooperative cancellation -------------------------------------------------


def test_run_prospect_research_stops_when_cancelled_after_research(db_session, workspace, admin_user, monkeypatch):
    _patch_full_signals(monkeypatch)
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)
    job = _enqueue_research_job(db_session, workspace, business, admin_user.id)

    # Simulate a cancel request arriving mid-run.
    real_is_cancel_requested = jobs_service.is_cancel_requested
    calls = {"n": 0}

    def fake_is_cancel_requested(db, job_id):
        calls["n"] += 1
        return calls["n"] >= 1  # cancelled on the first check, i.e. right after research

    monkeypatch.setattr(automation.jobs_service, "is_cancel_requested", fake_is_cancel_requested)

    try:
        automation.run_prospect_research(db_session, job)
        assert False, "expected JobCancelled"
    except jobs_service.JobCancelled:
        pass

    # Research itself still completed and persisted before the cancel was noticed.
    assert db_session.query(BusinessResearchResult).filter_by(discovered_business_id=business.id).count() == 1
    monkeypatch.setattr(automation.jobs_service, "is_cancel_requested", real_is_cancel_requested)


# --- min_score auto-archive --------------------------------------------------


def test_run_prospect_research_auto_archives_below_min_score(db_session, workspace, admin_user, monkeypatch):
    # No website on record scores very high in this codebase's model
    # ("no website" = strong redesign opportunity) — use an unreachable
    # site instead, which scores low, to exercise the below-minimum path
    # without depending on exact scoring internals beyond "some low score".
    async def fake_fetch(url):
        return ResearchPageSignals(error="net::ERR_CONNECTION_REFUSED")

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_fetch)

    search = _make_search(db_session, workspace, min_score=1000)  # impossible to reach -> always archives
    business = _make_discovered_business(db_session, search)
    job = _enqueue_research_job(db_session, workspace, business, admin_user.id)

    result = automation.run_prospect_research(db_session, job)
    assert result.get("auto_archived") is True

    db_session.refresh(business)
    assert business.status == DiscoveredBusinessStatus.ARCHIVED


def test_run_prospect_research_does_not_archive_when_no_min_score_configured(
    db_session, workspace, admin_user, monkeypatch
):
    _patch_full_signals(monkeypatch)
    search = _make_search(db_session, workspace, min_score=None)
    business = _make_discovered_business(db_session, search)
    job = _enqueue_research_job(db_session, workspace, business, admin_user.id)

    result = automation.run_prospect_research(db_session, job)
    assert "auto_archived" not in result

    db_session.refresh(business)
    assert business.status != DiscoveredBusinessStatus.ARCHIVED


# --- Automatic enqueue from discovery ----------------------------------------


def test_discovery_search_auto_enqueues_prospect_research_for_new_businesses(authed_client, monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query: [SearchResult(title="Fresh Plumbing Co", url="https://freshplumbing.example", description="")],
    )

    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"})
    assert res.status_code == 201

    jobs = authed_client.get(f"/api/v1/jobs?job_type={job_types.PROSPECT_RESEARCH}").json()
    assert len(jobs) == 1
    assert jobs[0]["status"] == "pending"


def test_discovery_search_does_not_enqueue_research_for_duplicates(authed_client, db_session, workspace, monkeypatch):
    db_session.add(
        Business(workspace_id=workspace.id, name="Existing Plumbing Co", website_url="https://existing.example")
    )
    db_session.commit()

    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query: [
            SearchResult(title="Existing Plumbing Co", url="https://existing.example", description="")
        ],
    )

    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"})
    assert res.status_code == 201

    jobs = authed_client.get(f"/api/v1/jobs?job_type={job_types.PROSPECT_RESEARCH}").json()
    assert jobs == []


# --- Full runner integration --------------------------------------------------


def test_prospect_research_end_to_end_via_runner(authed_client, db_session, workspace, monkeypatch):
    from app.jobs import runner

    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query: [SearchResult(title="Runner Plumbing Co", url="https://runnerplumbing.example", description="")],
    )
    _patch_full_signals(monkeypatch, final_url="https://runnerplumbing.example")

    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"})
    assert res.status_code == 201

    claimed = runner.run_once({job_types.PROSPECT_RESEARCH: automation.run_prospect_research})
    assert claimed is True

    db_session.expire_all()
    jobs = jobs_service.list_jobs(db_session, workspace.id, job_type=job_types.PROSPECT_RESEARCH)
    assert len(jobs) == 1
    assert jobs[0].status == JobStatus.DONE
