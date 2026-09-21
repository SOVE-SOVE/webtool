"""
Planning: a standalone, Lead-owned workspace for understanding a
prospect's existing website — created from a Lead, before any Project
exists (docs/05_DECISIONS.md). "Start Planning" opens (or creates) the
one Planning workspace for a lead without running anything; "Analyse
Website", a separate explicit action, enqueues the real background job
queue. This covers the deterministic findings agent directly, plus the
service/route/job layer — the two-step start/analyse split, the job
actually advancing status through analysing -> completed/needs_review/
failed, re-analysing in place, editing, workspace scoping, and the
Create Project handoff.
"""

import uuid

from app.agents import planning_audit as planning_audit_agent
from app.integrations import places
from app.integrations.browser import PlanningAuditSignals
from app.integrations.discovery.base import DiscoveryPage, NormalizedBusinessResult, WebsiteStatus
from app.integrations.discovery.google_places_provider import GooglePlacesDiscoveryProvider
from app.integrations.llm import LlmUnavailableError
from app.jobs import runner
from app.jobs.handlers import HANDLERS
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.planning import service as planning_service

VISUAL_REVIEW_LLM_OUTPUT = {
    "findings": [
        {
            "area": "visual",
            "category": "imagery",
            "severity": "medium",
            "message": "The homepage would benefit from stronger photography of completed work.",
            "evidence": "Only a single small logo image is visible above the fold in the desktop screenshot.",
            "confidence": 0.6,
        }
    ]
}

SUMMARY_LLM_OUTPUT = {
    "website_summary": (
        "The website includes the core business information, but the mobile experience is slower "
        "than ideal and key contact details are not immediately visible."
    )
}


def _patch_planning_llm(monkeypatch, summary_output=None, visual_output=None):
    monkeypatch.setattr(
        "app.agents.planning_summary.generate_structured",
        lambda **kwargs: dict(summary_output or SUMMARY_LLM_OUTPUT),
    )
    monkeypatch.setattr(
        "app.agents.planning_visual_review.generate_structured",
        lambda **kwargs: dict(visual_output or VISUAL_REVIEW_LLM_OUTPUT),
    )


def _patch_planning_fetch(monkeypatch, signals: PlanningAuditSignals):
    async def fake_fetch(url, on_progress=None):
        if on_progress:
            on_progress()
        return signals

    monkeypatch.setattr("app.modules.planning.service.fetch_planning_audit_signals", fake_fetch)


def _slow_mobile_unfriendly_signals(**overrides) -> PlanningAuditSignals:
    defaults = dict(
        final_url="https://coastalcafe.example/",
        https=True,
        http_status=200,
        title="Coastal Cafe",
        meta_description=None,
        viewport_meta_present=False,
        desktop_overflow=False,
        tablet_overflow=False,
        mobile_overflow=True,
        load_time_ms=4500,
        total_transfer_bytes=1_000_000,
        console_error_count=0,
        broken_internal_links=[],
        min_contrast_ratio=6.0,
        duplicate_ids=[],
        html_lang_present=True,
        h1_count=1,
        canonical_present=True,
        meta_robots_noindex=False,
        robots_txt_reachable=True,
        sitemap_xml_reachable=True,
        has_local_business_schema=False,
        contact_cta_present=False,
        social_links=[],
        generator_meta="Squarespace",
        screenshot_desktop_base64="ZGVza3RvcC1wbmc=",
        screenshot_mobile_base64="bW9iaWxlLXBuZw==",
    )
    defaults.update(overrides)
    return PlanningAuditSignals(**defaults)


def _create_lead(authed_client, **overrides):
    payload = {"business_name": "Coastal Cafe", "suburb": "Byron Bay", "state": "NSW"}
    payload.update(overrides)
    return authed_client.post("/api/v1/leads", json=payload).json()


def _drain_jobs():
    while runner.run_once(HANDLERS):
        pass


def _start_planning(authed_client, lead):
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/planning")
    assert res.status_code == 200
    return res.json()


def _start_and_analyse(
    authed_client, monkeypatch, lead, website_url=None, summary_output=None, visual_output=None, signals=None
):
    """Full happy path: Start Planning, then Analyse Website, then drain
    the real job queue and return the settled Planning item."""
    _patch_planning_fetch(monkeypatch, signals if signals is not None else _slow_mobile_unfriendly_signals())
    _patch_planning_llm(monkeypatch, summary_output=summary_output, visual_output=visual_output)
    planning = _start_planning(authed_client, lead)
    body = {"website_url": website_url} if website_url else {}
    res = authed_client.post(f"/api/v1/planning/{planning['id']}/analyse", json=body)
    assert res.status_code == 200
    _drain_jobs()
    return authed_client.get(f"/api/v1/planning/{planning['id']}").json()


# --- Agent: deterministic findings (unchanged from the prior pass, still valid) ---


def test_unreachable_site_produces_only_availability_finding():
    result = planning_audit_agent.run(PlanningAuditSignals(error="Timed out"))
    assert len(result.output.findings) == 1
    finding = result.output.findings[0]
    assert finding.category == "availability"
    assert finding.severity == "critical"
    assert result.flagged_for_review is True


def test_every_finding_has_required_fields():
    result = planning_audit_agent.run(_slow_mobile_unfriendly_signals())
    assert len(result.output.findings) >= 5
    for finding in result.output.findings:
        assert finding.area in ("technical", "seo", "accessibility", "usability", "visual")
        assert finding.category
        assert finding.severity in ("low", "medium", "high", "critical")
        assert 0.0 <= finding.confidence <= 1.0


# --- Start Planning: opens/creates the workspace, never runs anything --------


def test_start_planning_creates_a_bare_workspace_with_no_job_enqueued(authed_client):
    lead = _create_lead(authed_client)  # no website on record
    planning = _start_planning(authed_client, lead)

    assert planning["status"] == "ready_to_analyse"
    assert planning["website_url"] is None
    assert planning["analysed_at"] is None
    assert planning["key_points"] == []

    # Nothing was enqueued — draining the queue claims no job.
    assert runner.run_once(HANDLERS) is False


def test_start_planning_uses_the_leads_website_url_if_present(authed_client):
    lead = _create_lead(authed_client)
    authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"website_url": "https://coastalcafe.example"})

    planning = _start_planning(authed_client, lead)
    assert planning["website_url"] == "https://coastalcafe.example"
    assert planning["status"] == "ready_to_analyse"


def test_start_planning_is_idempotent_and_opens_the_existing_workspace(authed_client):
    lead = _create_lead(authed_client)
    first = _start_planning(authed_client, lead)
    second = _start_planning(authed_client, lead)

    assert first["id"] == second["id"]
    activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "lead", "entity_id": lead["id"]}
    ).json()
    assert sum(1 for a in activity if a["action"] == "planning_started") == 1


def test_start_planning_returns_404_for_missing_lead(authed_client):
    res = authed_client.post(f"/api/v1/leads/{uuid.uuid4()}/planning")
    assert res.status_code == 404


# --- Analyse Website: the separate, explicit trigger -------------------------


def test_analyse_requires_a_url_when_none_is_on_record(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/analyse")
    assert res.status_code == 400
    assert "website url" in res.json()["detail"].lower()


def test_analyse_accepts_an_operator_supplied_url_and_saves_it(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    assert result["website_url"] == "https://coastalcafe.example"
    assert result["status"] == "completed"


def test_analyse_returns_404_for_missing_item(authed_client):
    res = authed_client.post(f"/api/v1/planning/{uuid.uuid4()}/analyse", json={"website_url": "https://x.example"})
    assert res.status_code == 404


def test_analyse_flips_status_to_analysing_before_the_job_runs(authed_client, monkeypatch):
    """Regression test: run_analysis previously left status at
    ready_to_analyse after enqueueing, so the frontend's "is this still
    running" check (and its polling) never triggered — the button just
    looked like nothing had happened, which is exactly what let an
    operator click it repeatedly and stack duplicate jobs (see the next
    test). The response to POST /analyse itself, before any job runs,
    must already report analysing."""
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    _patch_planning_fetch(monkeypatch, _slow_mobile_unfriendly_signals())
    _patch_planning_llm(monkeypatch)
    res = authed_client.post(
        f"/api/v1/planning/{planning['id']}/analyse", json={"website_url": "https://coastalcafe.example"}
    )
    assert res.status_code == 200
    assert res.json()["status"] == "analysing"


def test_analyse_does_not_stack_duplicate_jobs_while_one_is_pending(authed_client, monkeypatch, db_session):
    from app.modules.jobs.models import Job
    from app.modules.jobs.job_types import JOB_PLANNING_ANALYSIS

    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    body = {"website_url": "https://coastalcafe.example"}
    for _ in range(3):
        res = authed_client.post(f"/api/v1/planning/{planning['id']}/analyse", json=body)
        assert res.status_code == 200

    pending = db_session.query(Job).filter(
        Job.job_type == JOB_PLANNING_ANALYSIS,
        Job.payload["planning_id"].as_string() == planning["id"],
    ).all()
    assert len(pending) == 1

    # And once that job actually finishes, a fresh Analyse Website click
    # enqueues a real new one again — the guard isn't permanent.
    _patch_planning_fetch(monkeypatch, _slow_mobile_unfriendly_signals())
    _patch_planning_llm(monkeypatch)
    _drain_jobs()
    res = authed_client.post(f"/api/v1/planning/{planning['id']}/analyse", json=body)
    assert res.status_code == 200
    all_jobs = db_session.query(Job).filter(
        Job.job_type == JOB_PLANNING_ANALYSIS,
        Job.payload["planning_id"].as_string() == planning["id"],
    ).all()
    assert len(all_jobs) == 2


# --- The background job actually runs and advances status --------------------


def test_analysis_job_completes_and_populates_findings_and_summary(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    assert result["status"] == "completed"
    assert result["website_summary"] == SUMMARY_LLM_OUTPUT["website_summary"]
    assert result["has_existing_site"] is True
    assert result["screenshot_desktop_base64"] == "ZGVza3RvcC1wbmc="
    assert result["screenshot_mobile_base64"] == "bW9iaWxlLXBuZw=="
    assert result["detected_technology"] == "Squarespace"
    assert len(result["key_points"]) >= 3
    assert any(kp["area"] == "visual" for kp in result["key_points"])
    assert result["analysed_at"] is not None
    # current_step is a live-progress marker only — cleared once the run
    # has actually settled, whatever it settled to.
    assert result["current_step"] is None


def test_analysis_job_records_real_progress_steps_in_order(authed_client, monkeypatch):
    """
    The frontend's "During audit" progress list is driven by
    current_step, set at each real phase boundary inside
    run_analysis_job (never simulated/timed) — this locks in that the
    five phases actually fire, in the documented order.
    """
    recorded: list[str] = []
    original_set_step = planning_service._set_step

    def _spy(db, planning, step):
        recorded.append(step.value)
        original_set_step(db, planning, step)

    monkeypatch.setattr(planning_service, "_set_step", _spy)

    lead = _create_lead(authed_client)
    _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    assert recorded == ["structure", "mobile", "technical", "visual", "summary"]


def test_analysis_job_clears_current_step_on_failure(authed_client, monkeypatch):
    lead = _create_lead(authed_client)

    async def _raise_fetch(url, on_progress=None):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.modules.planning.service.fetch_planning_audit_signals", _raise_fetch)

    planning = _start_planning(authed_client, lead)
    authed_client.post(f"/api/v1/planning/{planning['id']}/analyse", json={"website_url": "https://coastalcafe.example"})
    _drain_jobs()

    result = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    assert result["status"] == "failed"
    assert result["current_step"] is None


def test_analysis_job_marks_needs_review_when_llm_unavailable(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    _patch_planning_fetch(monkeypatch, _slow_mobile_unfriendly_signals())

    def _raise(**kwargs):
        raise LlmUnavailableError("AI generation is unavailable — no Claude API key is configured.")

    monkeypatch.setattr("app.agents.planning_summary.generate_structured", _raise)
    monkeypatch.setattr("app.agents.planning_visual_review.generate_structured", _raise)

    planning = _start_planning(authed_client, lead)
    authed_client.post(f"/api/v1/planning/{planning['id']}/analyse", json={"website_url": "https://coastalcafe.example"})
    _drain_jobs()

    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    assert body["status"] == "needs_review"
    assert "unavailable" in body["website_summary"].lower()
    assert len(body["key_points"]) >= 3  # deterministic findings still present
    assert not any(kp["area"] == "visual" for kp in body["key_points"])


def test_analysis_job_marks_failed_on_unexpected_error(authed_client, monkeypatch):
    lead = _create_lead(authed_client)

    async def _raise_fetch(url, on_progress=None):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.modules.planning.service.fetch_planning_audit_signals", _raise_fetch)

    planning = _start_planning(authed_client, lead)
    authed_client.post(f"/api/v1/planning/{planning['id']}/analyse", json={"website_url": "https://coastalcafe.example"})
    _drain_jobs()

    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    assert body["status"] == "failed"
    assert "boom" in body["error_message"]

    # Failed is not terminal — Analyse Website can be retried.
    _patch_planning_fetch(monkeypatch, _slow_mobile_unfriendly_signals())
    _patch_planning_llm(monkeypatch)
    authed_client.post(f"/api/v1/planning/{planning['id']}/analyse")
    _drain_jobs()
    retried = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    assert retried["status"] == "completed"


def test_website_unreachable_still_completes_but_needs_review(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(
        authed_client, monkeypatch, lead, website_url="https://nosuchsite.example",
        signals=PlanningAuditSignals(error="Could not resolve hostname"),
    )

    assert result["status"] == "needs_review"
    assert len(result["key_points"]) == 1
    assert result["key_points"][0]["category"] == "availability"


def test_reanalysing_updates_the_same_workspace_in_place(authed_client, monkeypatch):
    """Re-running Analyse Website must never create a second workspace
    for the same lead — it updates the one row."""
    lead = _create_lead(authed_client)
    first = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    second = _start_and_analyse(
        authed_client, monkeypatch, lead, website_url="https://coastalcafe.example",
        summary_output={"website_summary": "A freshly re-run analysis."},
    )

    assert second["id"] == first["id"]
    assert second["website_summary"] == "A freshly re-run analysis."
    assert second["website_audit_id"] != first["website_audit_id"]


# --- Getting the lead's one workspace ------------------------------------------


def test_get_planning_for_lead_is_null_before_starting(authed_client):
    lead = _create_lead(authed_client)
    res = authed_client.get(f"/api/v1/leads/{lead['id']}/planning")
    assert res.status_code == 200
    assert res.json() is None


def test_get_planning_for_lead_returns_404_for_missing_lead(authed_client):
    res = authed_client.get(f"/api/v1/leads/{uuid.uuid4()}/planning")
    assert res.status_code == 404


def test_workspace_wide_planning_list(authed_client, monkeypatch):
    lead = _create_lead(authed_client, suburb="Byron Bay", state="NSW")
    _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    items = authed_client.get("/api/v1/planning").json()
    assert len(items) == 1
    item = items[0]
    assert item["lead_business_name"] == "Coastal Cafe"
    assert "screenshot_desktop_base64" not in item
    assert item["project_id"] is None
    # Enriched list fields (docs/07_SESSION_LOG.md — Planning landing page
    # redesign): presence-only screenshot flag, derived mode signal, and
    # the lead's location, all without pulling the actual base64 payload.
    assert item["website_audit_id"] is not None
    assert item["has_screenshot"] is True
    assert item["lead_suburb"] == "Byron Bay"
    assert item["lead_state"] == "NSW"
    assert "updated_at" in item


def test_workspace_wide_planning_list_has_screenshot_false_without_an_audit_screenshot(authed_client):
    lead = _create_lead(authed_client)
    _start_planning(authed_client, lead)

    items = authed_client.get("/api/v1/planning").json()
    assert len(items) == 1
    assert items[0]["website_audit_id"] is None
    assert items[0]["has_screenshot"] is False


def test_planning_list_excludes_transferred_items_by_default(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    authed_client.post(f"/api/v1/planning/{result['id']}/build-brief/approve")
    project = authed_client.post(f"/api/v1/planning/{result['id']}/create-project").json()

    default_items = authed_client.get("/api/v1/planning").json()
    assert default_items == []

    all_items = authed_client.get("/api/v1/planning?include_transferred=true").json()
    assert len(all_items) == 1
    assert all_items[0]["project_id"] == project["id"]

    single = authed_client.get(f"/api/v1/planning/{result['id']}").json()
    assert single["project_id"] == project["id"]


# --- Checklist summaries (bulk, workspace-wide) ---------------------------------


def test_checklist_summaries_reflects_progress_and_next_item(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    summaries = authed_client.get("/api/v1/planning/checklist-summaries").json()
    assert len(summaries) == 1
    summary = summaries[0]
    assert summary["planning_id"] == planning["id"]
    assert summary["total"] == 6  # len(DEFAULT_PLANNING_TASKS), all required
    assert summary["completed"] == 0
    assert summary["pct"] == 0
    assert summary["next_item_title"] == "Review website audit or new-website research"

    checklist = authed_client.get(f"/api/v1/planning/{planning['id']}/checklist").json()
    first_item_id = checklist["items"][0]["id"]
    authed_client.patch(f"/api/v1/stage-checklist-items/{first_item_id}", json={"status": "complete"})

    summaries = authed_client.get("/api/v1/planning/checklist-summaries").json()
    assert summaries[0]["completed"] == 1
    assert summaries[0]["next_item_title"] == "Review Google Review Insights, where available"


def test_checklist_summaries_is_workspace_scoped(authed_client, other_authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    assert authed_client.get("/api/v1/planning/checklist-summaries").json() != []
    assert other_authed_client.get("/api/v1/planning/checklist-summaries").json() == []


# --- Screenshot thumbnail route --------------------------------------------------


def test_screenshot_route_returns_the_decoded_desktop_screenshot(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    res = authed_client.get(f"/api/v1/planning/{planning['id']}/screenshot")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.content == b"desktop-png"  # base64 "ZGVza3RvcC1wbmc=" decoded


def test_screenshot_route_404s_when_no_screenshot_exists(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = authed_client.get(f"/api/v1/planning/{planning['id']}/screenshot")
    assert res.status_code == 404


def test_screenshot_route_is_workspace_scoped(authed_client, other_authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    res = other_authed_client.get(f"/api/v1/planning/{planning['id']}/screenshot")
    assert res.status_code == 404


# --- Editing --------------------------------------------------------------------


def test_update_operator_notes_leaves_summary_untouched(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    res = authed_client.patch(f"/api/v1/planning/{result['id']}", json={"operator_notes": "Mention their new espresso machine."})
    assert res.status_code == 200
    body = res.json()
    assert body["operator_notes"] == "Mention their new espresso machine."
    assert body["website_summary"] == SUMMARY_LLM_OUTPUT["website_summary"]


def test_update_planning_returns_404_for_missing_item(authed_client):
    res = authed_client.patch(f"/api/v1/planning/{uuid.uuid4()}", json={"operator_notes": "x"})
    assert res.status_code == 404


# --- Create Project handoff ----------------------------------------------------


def test_create_project_from_planning_requires_an_approved_build_brief(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    res = authed_client.post(f"/api/v1/planning/{result['id']}/create-project")
    assert res.status_code == 400


def test_create_project_from_planning_carries_forward_summary_and_points(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    authed_client.post(f"/api/v1/planning/{result['id']}/build-brief/approve")

    res = authed_client.post(f"/api/v1/planning/{result['id']}/create-project")
    assert res.status_code == 201
    project = res.json()
    assert project["source_lead_id"] == lead["id"]
    assert SUMMARY_LLM_OUTPUT["website_summary"] in project["build_direction"]
    assert "Key points:" in project["build_direction"]


def test_create_project_from_planning_does_not_convert_the_lead(authed_client, monkeypatch):
    """A speculative Project from Planning must not convert the Lead —
    docs/05_DECISIONS.md. The Project is Lead-owned (no client_id) and
    the Lead's status/history are untouched."""
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    authed_client.post(f"/api/v1/planning/{result['id']}/build-brief/approve")

    res = authed_client.post(f"/api/v1/planning/{result['id']}/create-project")
    assert res.status_code == 201
    project = res.json()
    assert project["client_id"] is None
    assert project["source_lead_id"] == lead["id"]

    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["status"] == "new"
    assert lead_after["client_id"] is None
    assert lead_after["prospect_project"]["id"] == project["id"]

    clients = authed_client.get("/api/v1/clients").json()
    assert clients == []


def test_create_project_from_planning_returns_404_for_missing_item(authed_client):
    res = authed_client.post(f"/api/v1/planning/{uuid.uuid4()}/create-project")
    assert res.status_code == 404


def test_create_project_from_planning_is_idempotent_on_repeated_clicks(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    authed_client.post(f"/api/v1/planning/{result['id']}/build-brief/approve")
    first = authed_client.post(f"/api/v1/planning/{result['id']}/create-project").json()

    res = authed_client.post(f"/api/v1/planning/{result['id']}/create-project")
    assert res.status_code == 201
    second = res.json()
    assert second["id"] == first["id"]

    all_projects = authed_client.get("/api/v1/projects").json()
    matching = [p for p in all_projects if p["source_lead_id"] == lead["id"]]
    assert len(matching) == 1


# --- Workspace scoping -----------------------------------------------------------


def test_planning_is_workspace_scoped(authed_client, other_authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    assert other_authed_client.get(f"/api/v1/planning/{result['id']}").status_code == 404
    assert other_authed_client.get(f"/api/v1/leads/{lead['id']}/planning").status_code == 404
    assert other_authed_client.get("/api/v1/planning").json() == []


def test_start_planning_is_workspace_scoped(authed_client, other_authed_client):
    lead = _create_lead(authed_client)
    res = other_authed_client.post(f"/api/v1/leads/{lead['id']}/planning")
    assert res.status_code == 404


def test_analyse_planning_is_workspace_scoped(authed_client, other_authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = other_authed_client.post(
        f"/api/v1/planning/{planning['id']}/analyse", json={"website_url": "https://x.example"}
    )
    assert res.status_code == 404


# --- Remove from Planning (safe delete) -----------------------------------------


def test_delete_planning_removes_item_and_backing_audit(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    assert result["website_audit_id"] is not None

    res = authed_client.delete(f"/api/v1/planning/{result['id']}")
    assert res.status_code == 204

    assert authed_client.get(f"/api/v1/planning/{result['id']}").status_code == 404
    assert authed_client.get(f"/api/v1/leads/{lead['id']}/planning").json() is None


def test_delete_planning_preserves_the_lead_which_can_start_planning_again(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    authed_client.delete(f"/api/v1/planning/{result['id']}")

    # The lead itself is untouched — not archived, not deleted.
    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["id"] == lead["id"]
    assert lead_after["archived_at"] is None

    # And Start Planning creates a brand new workspace (the old one's gone).
    second = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    assert second["id"] != result["id"]
    assert second["status"] == "completed"


def test_delete_planning_does_not_affect_a_client_or_project_created_from_it(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    authed_client.post(f"/api/v1/planning/{result['id']}/build-brief/approve")
    project = authed_client.post(f"/api/v1/planning/{result['id']}/create-project").json()

    res = authed_client.delete(f"/api/v1/planning/{result['id']}")
    assert res.status_code == 204

    project_after = authed_client.get(f"/api/v1/projects/{project['id']}").json()
    assert project_after["id"] == project["id"]
    assert project_after["build_direction"] == project["build_direction"]


def test_delete_planning_logs_activity_on_the_lead(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    authed_client.delete(f"/api/v1/planning/{result['id']}")

    activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "lead", "entity_id": lead["id"]}
    ).json()
    assert any(a["action"] == "planning_removed" for a in activity)


def test_delete_planning_returns_404_for_missing_item(authed_client):
    res = authed_client.delete(f"/api/v1/planning/{uuid.uuid4()}")
    assert res.status_code == 404


def test_delete_planning_is_workspace_scoped(authed_client, other_authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    res = other_authed_client.delete(f"/api/v1/planning/{result['id']}")
    assert res.status_code == 404

    # Untouched from the owning workspace's point of view.
    still_there = authed_client.get(f"/api/v1/planning/{result['id']}")
    assert still_there.status_code == 200


# --- Google Review Insights -----------------------------------------------------
# Reuses modules/review_intelligence entirely for the reputation
# snapshot/themes/summary (see tests/test_review_intelligence.py for the
# lead-scoped fetch/persist/place-id-resolution coverage itself); these
# tests cover the Planning-level wiring — the endpoint, the new
# synthesis agent only running when there are themes to work with, and
# graceful degradation when no LLM is configured.

THREE_PRAISE_REVIEWS = [
    places.PlaceReview(rating=5, text="Friendly staff, very friendly team", published_at="2026-08-01T00:00:00Z"),
    places.PlaceReview(rating=5, text="So friendly and helpful every time", published_at="2026-08-10T00:00:00Z"),
    places.PlaceReview(rating=5, text="Really friendly staff, would recommend", published_at="2026-08-20T00:00:00Z"),
]

SYNTHESIS_LLM_OUTPUT = {
    "website_opportunities": [{"recommendation": "Highlight the friendly team on the homepage.", "based_on_theme": "Friendly staff"}],
    "faq_opportunities": [],
    "review_website_gaps": [],
}


def _patch_review_insights(monkeypatch, *, reviews=None, rating=4.8, review_count=42, synthesis_output=None):
    # No DiscoveredBusiness on record for this lead in most of these
    # tests, so place-id resolution falls through to a text_search —
    # give it one real-looking match rather than None, or the whole run
    # takes the "no_listing" branch and get_place_details is never
    # reached (see test_review_insights_no_google_listing_found_is_not_an_error
    # for the case that deliberately exercises that branch instead).
    monkeypatch.setattr(
        places,
        "text_search",
        lambda query, page_size=1, page_token=None: places.PlacesPage(
            results=[places.PlaceResult(place_id="places/found123", name="Coastal Cafe")]
        ),
    )
    monkeypatch.setattr(
        places,
        "get_place_details",
        lambda place_id: places.PlaceDetails(
            place_id=place_id, rating=rating, user_rating_count=review_count, reviews=reviews or []
        ),
    )
    monkeypatch.setattr(
        "app.agents.review_intelligence.generate_structured",
        lambda **kwargs: {"summary": "Customers consistently mention the friendly staff."},
    )
    monkeypatch.setattr(
        "app.agents.planning_review_insights.generate_structured",
        lambda **kwargs: dict(synthesis_output or SYNTHESIS_LLM_OUTPUT),
    )


def _link_discovered_business(db_session, authed_client, lead, *, place_id="places/abc123", **instagram_fields):
    search = DiscoverySearch(workspace_id=uuid.UUID(authed_client.get("/api/v1/auth/me").json()["workspace_id"]), industry="Cafes", provider="manual")
    db_session.add(search)
    db_session.commit()
    db_session.refresh(search)
    business = DiscoveredBusiness(
        discovery_search_id=search.id,
        name="Coastal Cafe",
        source_provider=GooglePlacesDiscoveryProvider.name,
        source_external_id=place_id,
        dedup_key="coastal cafe||",
        imported_lead_id=uuid.UUID(lead["id"]),
        **instagram_fields,
    )
    db_session.add(business)
    db_session.commit()
    return business


def test_review_insights_returns_404_for_missing_item(authed_client):
    res = authed_client.post(f"/api/v1/planning/{uuid.uuid4()}/review-insights")
    assert res.status_code == 404


def test_review_insights_with_no_reviews_saves_snapshot_and_skips_synthesis(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _patch_review_insights(monkeypatch, reviews=[])

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/review-insights")
    assert res.status_code == 200
    body = res.json()
    assert body["review_intelligence"]["data_status"] == "ok"
    assert body["review_intelligence"]["google_rating"] == 4.8
    # No review text at all -> the agent's deterministic fallback, no LLM call.
    assert "no review text is available" in body["review_summary"]
    assert body["review_website_opportunities"] == []
    assert body["review_faq_opportunities"] == []
    assert body["review_website_gaps"] == []
    assert body["review_insights_generated_at"] is not None


def test_review_insights_runs_synthesis_when_themes_are_present(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _patch_review_insights(monkeypatch, reviews=THREE_PRAISE_REVIEWS)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/review-insights")
    assert res.status_code == 200
    body = res.json()
    assert body["review_intelligence"]["themes_data_sufficient"] is True
    assert any(t["theme"] == "Friendly staff" for t in body["review_intelligence"]["positive_review_themes"])
    assert body["review_website_opportunities"] == SYNTHESIS_LLM_OUTPUT["website_opportunities"]


def test_review_insights_synthesis_failure_still_keeps_the_snapshot(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _patch_review_insights(monkeypatch, reviews=THREE_PRAISE_REVIEWS)

    def _boom(**kwargs):
        raise LlmUnavailableError("no API key configured")

    monkeypatch.setattr("app.agents.planning_review_insights.generate_structured", _boom)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/review-insights")
    assert res.status_code == 200
    body = res.json()
    assert body["review_summary"] == "Customers consistently mention the friendly staff."
    assert body["review_website_opportunities"] == []


def test_review_insights_prefers_a_known_place_id_over_a_text_search(authed_client, monkeypatch, db_session):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _link_discovered_business(db_session, authed_client, lead, place_id="places/known123")

    calls = {"text_search": 0, "place_id": None}

    def fake_text_search(query, page_size=1, page_token=None):
        calls["text_search"] += 1
        return None

    def fake_get_place_details(place_id):
        calls["place_id"] = place_id
        return places.PlaceDetails(place_id=place_id, rating=4.5, user_rating_count=10, reviews=[])

    monkeypatch.setattr(places, "text_search", fake_text_search)
    monkeypatch.setattr(places, "get_place_details", fake_get_place_details)
    monkeypatch.setattr("app.agents.review_intelligence.generate_structured", lambda **kwargs: {"summary": "x"})

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/review-insights")
    assert res.status_code == 200
    assert calls["text_search"] == 0
    assert calls["place_id"] == "places/known123"


def test_review_insights_no_google_listing_found_is_not_an_error(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(places, "text_search", lambda query, page_size=1, page_token=None: None)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/review-insights")
    assert res.status_code == 200
    body = res.json()
    assert body["review_intelligence"]["data_status"] == "no_listing"
    assert body["review_summary"] is None


def test_update_planning_can_edit_review_summary(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _patch_review_insights(monkeypatch, reviews=[])
    authed_client.post(f"/api/v1/planning/{planning['id']}/review-insights")

    res = authed_client.patch(f"/api/v1/planning/{planning['id']}", json={"review_summary": "Edited by the operator."})
    assert res.status_code == 200
    assert res.json()["review_summary"] == "Edited by the operator."


def test_review_insights_is_workspace_scoped(authed_client, other_authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _patch_review_insights(monkeypatch, reviews=[])

    res = other_authed_client.post(f"/api/v1/planning/{planning['id']}/review-insights")
    assert res.status_code == 404


# --- New Website Plan mode (no existing website to audit) -----------------

PLAN_LLM_OUTPUT = {
    "recommended_objective": "Generate phone enquiries for kitchen renovation quotes.",
    "priority_pages": [
        {"title": "Home", "purpose": "Introduce the business and its main service."},
        {"title": "Services", "purpose": "List kitchen renovation services offered."},
        {"title": "Gallery", "purpose": "Show completed work."},
        {"title": "Contact", "purpose": "Make it easy to call or enquire."},
    ],
    "content_priorities": ["Kitchen renovation services", "Completed project gallery"],
    "contact_priorities": ["Phone number prominent on every page"],
    "visual_priorities": ["Real photos of completed kitchens"],
    "open_questions": ["No services list on file — confirm exact services offered."],
    "website_summary": "A simple site to generate renovation enquiries by phone.",
}


def test_generate_website_plan_builds_from_verified_inputs_and_completes(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Kitchen Renovation", phone="0400111222")
    planning = _start_planning(authed_client, lead)
    assert planning["website_url"] is None  # no website on record for this lead — New Website Plan mode

    captured = {}

    def fake_generate(**kwargs):
        captured.update(kwargs)
        return dict(PLAN_LLM_OUTPUT)

    monkeypatch.setattr("app.agents.planning_website_direction.generate_structured", fake_generate)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/generate-website-plan")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "completed"
    assert body["website_audit_id"] is None  # still no audit — the other mode
    assert body["recommended_objective"] == PLAN_LLM_OUTPUT["recommended_objective"]
    assert len(body["priority_pages"]) == 4
    assert body["content_priorities"] == PLAN_LLM_OUTPUT["content_priorities"]
    assert body["open_questions"] == PLAN_LLM_OUTPUT["open_questions"]
    assert body["website_summary"] == PLAN_LLM_OUTPUT["website_summary"]
    assert body["website_plan_generated_at"] is not None

    assert "Kitchen Renovation" in captured["user"]
    assert "0400111222" in captured["user"]


def test_generate_website_plan_degrades_gracefully_without_llm(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)

    def _boom(**kwargs):
        raise LlmUnavailableError("no API key configured")

    monkeypatch.setattr("app.agents.planning_website_direction.generate_structured", _boom)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/generate-website-plan")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "needs_review"
    assert body["recommended_objective"] is None
    assert body["priority_pages"] == []
    assert "Coastal Cafe" in body["website_summary"]
    assert body["website_plan_generated_at"] is not None


def test_generate_website_plan_uses_existing_review_themes(authed_client, monkeypatch, db_session):
    from app.modules.review_intelligence.models import ReviewIntelligenceResult

    lead = _create_lead(authed_client, industry="Nail Salon")
    planning = _start_planning(authed_client, lead)

    review = ReviewIntelligenceResult(
        lead_id=uuid.UUID(lead["id"]),
        positive_review_themes=[
            {"theme": "Friendly staff", "occurrences": 3, "confidence": 0.9, "evidence": ["so friendly"]}
        ],
    )
    db_session.add(review)
    db_session.commit()
    db_session.refresh(review)

    conn_db = db_session
    from app.modules.planning.models import LeadPlanning as _LP

    row = conn_db.get(_LP, uuid.UUID(planning["id"]))
    row.review_intelligence_id = review.id
    conn_db.commit()

    captured = {}
    monkeypatch.setattr(
        "app.agents.planning_website_direction.generate_structured",
        lambda **kwargs: (captured.update(kwargs), dict(PLAN_LLM_OUTPUT))[1],
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/generate-website-plan")
    assert res.status_code == 200
    assert "Friendly staff" in captured["user"]


def test_generate_website_plan_returns_404_for_missing_item(authed_client):
    res = authed_client.post(f"/api/v1/planning/{uuid.uuid4()}/generate-website-plan")
    assert res.status_code == 404


def test_generate_website_plan_is_workspace_scoped(authed_client, other_authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr("app.agents.planning_website_direction.generate_structured", lambda **kwargs: dict(PLAN_LLM_OUTPUT))

    res = other_authed_client.post(f"/api/v1/planning/{planning['id']}/generate-website-plan")
    assert res.status_code == 404


def test_create_project_from_new_website_plan_carries_forward_plan_content(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr("app.agents.planning_website_direction.generate_structured", lambda **kwargs: dict(PLAN_LLM_OUTPUT))
    authed_client.post(f"/api/v1/planning/{planning['id']}/generate-website-plan")
    authed_client.post(f"/api/v1/planning/{planning['id']}/build-brief/approve")

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/create-project")
    assert res.status_code == 201
    project = res.json()
    assert PLAN_LLM_OUTPUT["recommended_objective"] in project["build_direction"]
    assert "Home: Introduce the business" in project["build_direction"]


# --- Social Presence (Instagram/Facebook input) -----------------------------


def test_social_profile_falls_back_to_discovered_business_instagram_data(authed_client, db_session):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _link_discovered_business(
        db_session,
        authed_client,
        lead,
        instagram_handle="coastalcafe",
        instagram_bio="Beachside coffee and brunch.",
        instagram_profile_url="https://instagram.com/coastalcafe",
        instagram_follower_count=1200,
    )

    res = authed_client.get(f"/api/v1/planning/{planning['id']}")
    assert res.status_code == 200
    profile = res.json()["social_profile"]
    assert profile["instagram_handle"] == "coastalcafe"
    assert profile["instagram_bio"] == "Beachside coffee and brunch."
    assert profile["instagram_follower_count"] == 1200
    assert profile["instagram_source"] == "discovered_business"
    assert profile["facebook_page_url"] is None
    assert profile["has_any"] is True


def test_social_profile_with_no_data_at_all_is_empty(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = authed_client.get(f"/api/v1/planning/{planning['id']}")
    assert res.status_code == 200
    profile = res.json()["social_profile"]
    assert profile["has_any"] is False
    assert profile["instagram_source"] is None
    assert profile["facebook_source"] is None


def test_operator_edit_locks_in_instagram_as_operator_entered_and_preserves_untouched_fields(
    authed_client, db_session
):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _link_discovered_business(
        db_session,
        authed_client,
        lead,
        instagram_handle="coastalcafe",
        instagram_bio="Beachside coffee and brunch.",
    )

    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/social-profile", json={"instagram_handle": "coastal_cafe_official"}
    )
    assert res.status_code == 200
    profile = res.json()["social_profile"]
    assert profile["instagram_handle"] == "coastal_cafe_official"
    assert profile["instagram_source"] == "operator_entered"
    assert profile["instagram_verified_at"] is not None
    # The bio wasn't touched by this edit — it must be preserved, not wiped.
    assert profile["instagram_bio"] == "Beachside coffee and brunch."


def test_operator_can_add_facebook_page_with_no_fallback_source(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/social-profile",
        json={"facebook_page_url": "https://facebook.com/coastalcafe", "facebook_page_name": "Coastal Cafe"},
    )
    assert res.status_code == 200
    profile = res.json()["social_profile"]
    assert profile["facebook_page_url"] == "https://facebook.com/coastalcafe"
    assert profile["facebook_source"] == "operator_entered"
    assert profile["has_any"] is True


def test_update_social_profile_returns_404_for_missing_item(authed_client):
    res = authed_client.patch(f"/api/v1/planning/{uuid.uuid4()}/social-profile", json={"facebook_page_url": "x"})
    assert res.status_code == 404


def test_update_social_profile_is_workspace_scoped(authed_client, other_authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = other_authed_client.patch(
        f"/api/v1/planning/{planning['id']}/social-profile", json={"facebook_page_url": "https://facebook.com/x"}
    )
    assert res.status_code == 404


def test_generate_website_plan_includes_facebook_and_extended_instagram_fields_in_agent_input(
    authed_client, monkeypatch, db_session
):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)
    _link_discovered_business(
        db_session,
        authed_client,
        lead,
        instagram_handle="coastalcafe",
        instagram_bio="Beachside coffee and brunch.",
        instagram_profile_url="https://instagram.com/coastalcafe",
        instagram_follower_count=1200,
        instagram_profile_image_url="https://instagram.com/coastalcafe/profile.jpg",
    )
    authed_client.patch(
        f"/api/v1/planning/{planning['id']}/social-profile",
        json={"facebook_page_url": "https://facebook.com/coastalcafe", "facebook_bio": "A beachside cafe."},
    )

    captured = {}

    def fake_generate(**kwargs):
        captured.update(kwargs)
        return dict(PLAN_LLM_OUTPUT)

    monkeypatch.setattr("app.agents.planning_website_direction.generate_structured", fake_generate)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/generate-website-plan")
    assert res.status_code == 200
    assert "coastalcafe" in captured["user"]
    assert "1200 followers" in captured["user"]
    assert "facebook.com/coastalcafe" in captured["user"]
    assert "A beachside cafe." in captured["user"]
    assert "reference only" in captured["user"]


def test_generate_website_plan_still_degrades_gracefully_with_no_social_data(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)

    def _boom(**kwargs):
        raise LlmUnavailableError("no API key configured")

    monkeypatch.setattr("app.agents.planning_website_direction.generate_structured", _boom)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/generate-website-plan")
    assert res.status_code == 200
    assert res.json()["status"] == "needs_review"


def test_existing_website_mode_social_profile_is_empty(authed_client, monkeypatch):
    """Existing Website mode never surfaces Social Presence — confirms
    _to_read's mode check correctly skips it once a real audit exists."""
    lead = _create_lead(authed_client)
    body = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    assert body["website_audit_id"] is not None
    assert body["social_profile"]["has_any"] is False


# --- Research Comparable Websites -------------------------------------------


def _fake_comparable_provider(results):
    class _FakeProvider:
        name = "google_places"

        def discover(self, criteria, db=None):
            return DiscoveryPage(results=results, has_more=False)

    return _FakeProvider()


def _comparable_result(name, url, *, website_status=WebsiteStatus.FOUND, **overrides):
    defaults = dict(
        name=name,
        website_url=url,
        website_status=website_status,
        business_category="Cafe",
        suburb="Byron Bay",
        state="NSW",
        raw_snippet=f"{name} — a local cafe in Byron Bay",
    )
    defaults.update(overrides)
    return NormalizedBusinessResult(**defaults)


def test_comparable_search_filters_to_websites_and_excludes_own_domain(authed_client, monkeypatch):
    lead = _create_lead(authed_client, website_url="https://coastalcafe.example", industry="Cafes")
    planning = _start_planning(authed_client, lead)

    results = [
        _comparable_result("Coastal Cafe", "https://coastalcafe.example"),  # own business — excluded
        _comparable_result("No Website Cafe", None, website_status=WebsiteStatus.NONE),  # no site — excluded
        _comparable_result("Sunrise Cafe", "https://sunrisecafe.example"),
        _comparable_result("Beachside Cafe", "https://beachsidecafe.example"),
        _comparable_result("Sunrise Cafe Duplicate", "https://sunrisecafe.example"),  # dup hostname — excluded
    ]
    monkeypatch.setattr(planning_service.discovery_registry, "default_provider", lambda: "google_places")
    monkeypatch.setattr(
        planning_service.discovery_registry, "get_provider", lambda name: _fake_comparable_provider(results)
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/search")
    assert res.status_code == 200
    body = res.json()
    sites = body["comparable_sites"]
    assert len(sites) == 2
    assert {s["website_url"] for s in sites} == {"https://sunrisecafe.example", "https://beachsidecafe.example"}
    assert all(s["included"] for s in sites)
    assert all(s["source_provider"] == "google_places" for s in sites)
    assert body["comparable_research_status"] == "ready_for_review"


def test_comparable_search_caps_at_five_and_a_re_search_replaces_the_batch(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)

    many_results = [_comparable_result(f"Cafe {i}", f"https://cafe{i}.example") for i in range(8)]
    monkeypatch.setattr(planning_service.discovery_registry, "default_provider", lambda: "google_places")
    monkeypatch.setattr(
        planning_service.discovery_registry, "get_provider", lambda name: _fake_comparable_provider(many_results)
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/search")
    assert len(res.json()["comparable_sites"]) == 5

    # A re-search with fewer results replaces the previous batch entirely.
    monkeypatch.setattr(
        planning_service.discovery_registry,
        "get_provider",
        lambda name: _fake_comparable_provider([_comparable_result("Only Cafe", "https://onlycafe.example")]),
    )
    res = authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/search")
    sites = res.json()["comparable_sites"]
    assert len(sites) == 1
    assert sites[0]["website_url"] == "https://onlycafe.example"


def test_update_comparable_site_toggle_and_404_for_unknown_site(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(planning_service.discovery_registry, "default_provider", lambda: "google_places")
    monkeypatch.setattr(
        planning_service.discovery_registry,
        "get_provider",
        lambda name: _fake_comparable_provider([_comparable_result("Sunrise Cafe", "https://sunrisecafe.example")]),
    )
    res = authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/search")
    site_id = res.json()["comparable_sites"][0]["id"]

    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/comparable-sites/{site_id}", json={"included": False}
    )
    assert res.status_code == 200
    assert res.json()["comparable_sites"][0]["included"] is False

    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/comparable-sites/{uuid.uuid4()}", json={"included": False}
    )
    assert res.status_code == 404


def test_analyse_comparable_sites_requires_at_least_one_included(authed_client):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/analyse")
    assert res.status_code == 400


COMPARABLE_PATTERNS_LLM_OUTPUT = {
    "patterns": [{"pattern": "Most reference sites show a phone number in the header.", "evidence": "2 of 2 sites"}],
    "opportunities": [
        {"opportunity": "Put the phone number in the header.", "rationale": "Matches the pattern across references."}
    ],
}


def test_comparable_analysis_job_skips_failed_fetch_and_never_persists_screenshots(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(planning_service.discovery_registry, "default_provider", lambda: "google_places")
    monkeypatch.setattr(
        planning_service.discovery_registry,
        "get_provider",
        lambda name: _fake_comparable_provider(
            [
                _comparable_result("Sunrise Cafe", "https://sunrisecafe.example"),
                _comparable_result("Beachside Cafe", "https://beachsidecafe.example"),
            ]
        ),
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/search")

    async def fake_fetch(url, on_progress=None):
        if "beachside" in url:
            return PlanningAuditSignals(error="Navigation timed out")
        return _slow_mobile_unfriendly_signals(final_url=url, title="Sunrise Cafe — Home")

    monkeypatch.setattr("app.modules.planning.service.fetch_planning_audit_signals", fake_fetch)
    monkeypatch.setattr(
        "app.agents.planning_comparable_patterns.generate_structured",
        lambda **kwargs: dict(COMPARABLE_PATTERNS_LLM_OUTPUT),
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/analyse")
    assert res.status_code == 200
    _drain_jobs()

    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    assert body["comparable_research_status"] == "completed"
    assert body["comparable_research_patterns"] == COMPARABLE_PATTERNS_LLM_OUTPUT["patterns"]
    assert body["comparable_research_opportunities"] == COMPARABLE_PATTERNS_LLM_OUTPUT["opportunities"]

    by_url = {s["website_url"]: s for s in body["comparable_sites"]}
    assert by_url["https://sunrisecafe.example"]["fetch_ok"] is True
    assert by_url["https://beachsidecafe.example"]["fetch_ok"] is False
    # No screenshot field exists anywhere on a comparable-site row — the
    # schema itself has no place to put one (see PlanningComparableSiteRead).
    assert "screenshot_desktop_base64" not in by_url["https://sunrisecafe.example"]


def test_comparable_analysis_needs_review_when_llm_unavailable(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(planning_service.discovery_registry, "default_provider", lambda: "google_places")
    monkeypatch.setattr(
        planning_service.discovery_registry,
        "get_provider",
        lambda name: _fake_comparable_provider([_comparable_result("Sunrise Cafe", "https://sunrisecafe.example")]),
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/search")

    async def fake_fetch(url, on_progress=None):
        return _slow_mobile_unfriendly_signals(final_url=url)

    def _boom(**kwargs):
        raise LlmUnavailableError("no API key configured")

    monkeypatch.setattr("app.modules.planning.service.fetch_planning_audit_signals", fake_fetch)
    monkeypatch.setattr("app.agents.planning_comparable_patterns.generate_structured", _boom)

    authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/analyse")
    _drain_jobs()

    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    assert body["comparable_research_status"] == "needs_review"
    assert body["comparable_research_patterns"] == []


def test_comparable_sites_are_removed_when_planning_is_deleted(authed_client, monkeypatch, db_session):
    from app.modules.planning.models import LeadPlanningComparableSite

    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(planning_service.discovery_registry, "default_provider", lambda: "google_places")
    monkeypatch.setattr(
        planning_service.discovery_registry,
        "get_provider",
        lambda name: _fake_comparable_provider([_comparable_result("Sunrise Cafe", "https://sunrisecafe.example")]),
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/comparable-sites/search")

    res = authed_client.delete(f"/api/v1/planning/{planning['id']}")
    assert res.status_code == 204
    assert db_session.query(LeadPlanningComparableSite).count() == 0


# --- Build Brief: Keep / Improve / Add --------------------------------------

RECOMMENDATIONS_LLM_OUTPUT = {
    "website_objective": "Generate phone enquiries for kitchen renovation quotes.",
    "keep": [
        {
            "title": "Fast page load",
            "explanation": "The homepage loads quickly, which keeps visitors engaged.",
            "source_type": "audit_finding",
            "source_evidence": "Load time is within acceptable range.",
        }
    ],
    "improve": [
        {
            "title": "Fix mobile overflow",
            "explanation": "Content overflows on mobile, forcing visitors to scroll sideways.",
            "source_type": "audit_finding",
            "source_evidence": "Content overflows horizontally at mobile width.",
        }
    ],
    "add": [
        {
            "title": "Services page",
            "explanation": "A dedicated services page would make offerings clear.",
            "source_type": "business_info",
            "source_evidence": None,
        }
    ],
}


def test_generate_recommendations_existing_website_mode_grounds_improve_in_audit_findings(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Kitchen Renovation")
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    monkeypatch.setattr(
        "app.agents.planning_recommendations.generate_structured", lambda **kwargs: dict(RECOMMENDATIONS_LLM_OUTPUT)
    )

    res = authed_client.post(f"/api/v1/planning/{result['id']}/recommendations/generate")
    assert res.status_code == 200
    body = res.json()
    assert body["recommendations_objective"] == RECOMMENDATIONS_LLM_OUTPUT["website_objective"]
    by_category = {"keep": [], "improve": [], "add": []}
    for r in body["recommendations"]:
        by_category[r["category"]].append(r)
    assert len(by_category["keep"]) == 1
    assert len(by_category["improve"]) == 1
    assert by_category["improve"][0]["status"] == "proposed"
    assert len(by_category["add"]) == 1


def test_generate_recommendations_new_website_plan_mode_has_no_audit_to_cite(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)
    captured = {}

    def fake_generate(**kwargs):
        captured.update(kwargs)
        return {"website_objective": "Generate bookings.", "keep": [], "improve": [], "add": []}

    monkeypatch.setattr("app.agents.planning_recommendations.generate_structured", fake_generate)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/recommendations/generate")
    assert res.status_code == 200
    assert "no — building the first one" in captured["user"]
    assert "Audit findings: none on file" in captured["user"]


def test_generate_recommendations_degrades_gracefully_without_llm(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Cafes")
    planning = _start_planning(authed_client, lead)

    def _boom(**kwargs):
        raise LlmUnavailableError("no API key configured")

    monkeypatch.setattr("app.agents.planning_recommendations.generate_structured", _boom)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/recommendations/generate")
    assert res.status_code == 503


def test_regenerating_recommendations_only_appends_never_edits_existing_rows(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Kitchen Renovation")
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    monkeypatch.setattr(
        "app.agents.planning_recommendations.generate_structured", lambda **kwargs: dict(RECOMMENDATIONS_LLM_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{result['id']}/recommendations/generate")

    body = authed_client.get(f"/api/v1/planning/{result['id']}").json()
    keep_rec = next(r for r in body["recommendations"] if r["category"] == "keep")
    authed_client.patch(
        f"/api/v1/planning/{result['id']}/recommendations/{keep_rec['id']}", json={"status": "accepted", "title": "Edited by operator"}
    )

    # Regenerate with one new item plus the same "Fix mobile overflow" title.
    new_output = dict(RECOMMENDATIONS_LLM_OUTPUT)
    new_output["add"] = RECOMMENDATIONS_LLM_OUTPUT["add"] + [
        {"title": "Gallery page", "explanation": "Show finished work.", "source_type": "business_info", "source_evidence": None}
    ]
    monkeypatch.setattr("app.agents.planning_recommendations.generate_structured", lambda **kwargs: dict(new_output))
    authed_client.post(f"/api/v1/planning/{result['id']}/recommendations/generate")

    body = authed_client.get(f"/api/v1/planning/{result['id']}").json()
    titles = [r["title"] for r in body["recommendations"]]
    assert titles.count("Fix mobile overflow") == 1  # not duplicated
    assert "Edited by operator" in titles  # the operator's edit survived
    assert "Gallery page" in titles  # the genuinely new item was appended
    edited = next(r for r in body["recommendations"] if r["title"] == "Edited by operator")
    assert edited["status"] == "accepted"


def test_add_dismiss_and_delete_recommendation(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = authed_client.post(
        f"/api/v1/planning/{planning['id']}/recommendations",
        json={"category": "add", "title": "Custom page", "explanation": "Operator's own idea."},
    )
    assert res.status_code == 200
    rec = next(r for r in res.json()["recommendations"] if r["title"] == "Custom page")
    assert rec["status"] == "accepted"  # operator-added starts accepted
    assert rec["source_type"] == "operator"

    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/recommendations/{rec['id']}", json={"status": "dismissed"}
    )
    assert res.json()["recommendations"][0]["status"] == "dismissed"

    res = authed_client.delete(f"/api/v1/planning/{planning['id']}/recommendations/{rec['id']}")
    assert res.json()["recommendations"] == []


def test_recommendations_are_workspace_scoped(authed_client, other_authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    res = other_authed_client.post(f"/api/v1/planning/{planning['id']}/recommendations/generate")
    assert res.status_code == 404


# --- Build Brief: Proposed Sitemap and Homepage Outline ---------------------

SITEMAP_PROPOSAL_LLM_OUTPUT = {
    "pages": [
        {
            "title": "Home",
            "page_type": "home",
            "purpose": "Introduce the business.",
            "reason": "Every site needs an entry point.",
            "key_sections": ["hero", "cta"],
            "needs_confirmation": False,
        },
        {
            "title": "Services",
            "page_type": "services",
            "purpose": "List services offered.",
            "reason": "Core offering for this category.",
            "key_sections": ["service cards"],
            "needs_confirmation": True,
        },
    ]
}


def test_generate_sitemap_proposal_and_reuses_real_page_type_enum(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Kitchen Renovation")
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(
        "app.agents.planning_sitemap_proposal.generate_structured", lambda **kwargs: dict(SITEMAP_PROPOSAL_LLM_OUTPUT)
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/sitemap/generate")
    assert res.status_code == 200
    pages = res.json()["sitemap_pages"]
    assert len(pages) == 2
    assert pages[0]["page_type"] == "home"
    assert pages[1]["needs_confirmation"] is True


def test_sitemap_proposal_falls_back_to_custom_for_an_invalid_page_type(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    bad_output = {"pages": [{"title": "Menu", "page_type": "not_a_real_type", "purpose": "Show the menu.", "reason": "Restaurant.", "key_sections": [], "needs_confirmation": False}]}
    monkeypatch.setattr("app.agents.planning_sitemap_proposal.generate_structured", lambda **kwargs: dict(bad_output))

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/sitemap/generate")
    assert res.status_code == 200
    assert res.json()["sitemap_pages"][0]["page_type"] == "custom"


def test_add_edit_reorder_and_delete_sitemap_page(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = authed_client.post(
        f"/api/v1/planning/{planning['id']}/sitemap",
        json={"title": "Gallery", "page_type": "portfolio", "purpose": "Show finished work."},
    )
    page = res.json()["sitemap_pages"][0]

    res = authed_client.patch(f"/api/v1/planning/{planning['id']}/sitemap/{page['id']}", json={"title": "Our Work"})
    assert res.json()["sitemap_pages"][0]["title"] == "Our Work"

    res = authed_client.post(
        f"/api/v1/planning/{planning['id']}/sitemap", json={"title": "Contact", "page_type": "contact", "purpose": "Enquiries."}
    )
    pages = res.json()["sitemap_pages"]
    contact_id = next(p["id"] for p in pages if p["title"] == "Contact")
    our_work_id = next(p["id"] for p in pages if p["title"] == "Our Work")
    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/sitemap/reorder",
        json={"pages": [{"id": contact_id, "order_index": 0}, {"id": our_work_id, "order_index": 1}]},
    )
    ordered = sorted(res.json()["sitemap_pages"], key=lambda p: p["order_index"])
    assert ordered[0]["title"] == "Contact"

    res = authed_client.delete(f"/api/v1/planning/{planning['id']}/sitemap/{contact_id}")
    assert len(res.json()["sitemap_pages"]) == 1


# --- Build Brief: Visual Direction Choices ----------------------------------

VISUAL_DIRECTIONS_LLM_OUTPUT = {
    "options": [
        {
            "character": "Warm and handcrafted",
            "typography": "Rounded, friendly sans-serif",
            "colour_palette": "Terracotta and cream",
            "imagery": "Real photos of finished work",
            "layout": "Generous whitespace",
        },
        {
            "character": "Clean and modern",
            "typography": "Geometric sans-serif",
            "colour_palette": "Charcoal and white",
            "imagery": "Minimal product shots",
            "layout": "Grid-based",
        },
    ]
}


def test_generate_and_select_visual_direction(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(
        "app.agents.planning_visual_directions.generate_structured", lambda **kwargs: dict(VISUAL_DIRECTIONS_LLM_OUTPUT)
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/visual-directions/generate")
    assert res.status_code == 200
    body = res.json()
    assert len(body["visual_direction_options"]) == 2
    assert body["selected_visual_direction"] is None

    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/visual-directions/select", json={"option_index": 0, "character": "Warm, handcrafted, and inviting"}
    )
    assert res.status_code == 200
    selected = res.json()["selected_visual_direction"]
    assert selected["character"] == "Warm, handcrafted, and inviting"  # operator edit applied
    assert selected["typography"] == VISUAL_DIRECTIONS_LLM_OUTPUT["options"][0]["typography"]  # untouched field kept


def test_regenerating_visual_directions_never_touches_an_existing_selection(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(
        "app.agents.planning_visual_directions.generate_structured", lambda **kwargs: dict(VISUAL_DIRECTIONS_LLM_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/visual-directions/generate")
    authed_client.patch(f"/api/v1/planning/{planning['id']}/visual-directions/select", json={"option_index": 1})

    new_output = {"options": [{"character": "Bold", "typography": "Heavy display type", "colour_palette": "Black and yellow", "imagery": "High-contrast", "layout": "Asymmetric"}]}
    monkeypatch.setattr("app.agents.planning_visual_directions.generate_structured", lambda **kwargs: dict(new_output))
    res = authed_client.post(f"/api/v1/planning/{planning['id']}/visual-directions/generate")

    body = res.json()
    assert len(body["visual_direction_options"]) == 1  # candidate pool replaced
    assert body["selected_visual_direction"]["character"] == "Clean and modern"  # selection untouched


def test_select_visual_direction_without_index_or_prior_selection_returns_400(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    res = authed_client.patch(f"/api/v1/planning/{planning['id']}/visual-directions/select", json={})
    assert res.status_code == 400


# --- Build Brief: Assets Checklist ------------------------------------------


def test_assets_checklist_seeds_from_real_records_and_instagram_image_is_reference_only(
    authed_client, monkeypatch, db_session
):
    lead = _create_lead(authed_client, phone="0400111222")
    planning = _start_planning(authed_client, lead)
    _link_discovered_business(
        db_session, authed_client, lead, instagram_profile_image_url="https://instagram.com/x/pic.jpg"
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/assets/refresh")
    assert res.status_code == 200
    assets = {a["category"]: a for a in res.json()["assets"]}
    assert assets["photos"]["status"] == "reference_only"  # never ready_to_use from a social image
    assert assets["contact_details"]["status"] == "ready_to_use"
    assert assets["logo"]["status"] == "missing"


def test_refreshing_assets_checklist_only_adds_never_touches_existing_rows(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    authed_client.post(f"/api/v1/planning/{planning['id']}/assets/refresh")
    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    logo_asset = next(a for a in body["assets"] if a["category"] == "logo")

    authed_client.patch(
        f"/api/v1/planning/{planning['id']}/assets/{logo_asset['id']}",
        json={"status": "ready_to_use", "note": "Received via email."},
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/assets/refresh")
    body = res.json()
    assert len(body["assets"]) == 5  # no duplicates
    logo_after = next(a for a in body["assets"] if a["category"] == "logo")
    assert logo_after["status"] == "ready_to_use"  # operator's edit preserved
    assert logo_after["note"] == "Received via email."


def test_add_and_update_custom_asset(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    res = authed_client.post(
        f"/api/v1/planning/{planning['id']}/assets", json={"category": "video", "label": "Intro video", "status": "missing"}
    )
    asset = res.json()["assets"][0]
    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/assets/{asset['id']}", json={"status": "needs_owner_approval"}
    )
    assert res.json()["assets"][0]["status"] == "needs_owner_approval"


# --- Build Brief: compiled preview + approval + Create Project handoff -----


def test_build_brief_compute_reflects_accepted_recommendations_and_open_questions(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Kitchen Renovation")
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    monkeypatch.setattr(
        "app.agents.planning_recommendations.generate_structured", lambda **kwargs: dict(RECOMMENDATIONS_LLM_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{result['id']}/recommendations/generate")
    body = authed_client.get(f"/api/v1/planning/{result['id']}").json()
    add_rec = next(r for r in body["recommendations"] if r["category"] == "add")
    authed_client.patch(f"/api/v1/planning/{result['id']}/recommendations/{add_rec['id']}", json={"status": "accepted"})

    res = authed_client.get(f"/api/v1/planning/{result['id']}/build-brief")
    assert res.status_code == 200
    brief = res.json()
    assert brief["objective"] == RECOMMENDATIONS_LLM_OUTPUT["website_objective"]
    assert len(brief["accepted_recommendations"]) == 1  # "keep"/"improve" still proposed, not accepted
    assert brief["is_approved"] is False
    assert any("Business name" in f["fact"] for f in brief["confirmed_facts"])


def test_approve_build_brief_snapshots_current_state(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/build-brief/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["is_approved"] is True
    assert body["approved_at"] is not None
    assert body["project_id"] is None


def test_reapproving_before_a_project_exists_updates_the_snapshot(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    authed_client.post(f"/api/v1/planning/{planning['id']}/build-brief/approve")

    authed_client.post(
        f"/api/v1/planning/{planning['id']}/recommendations",
        json={"category": "add", "title": "New idea", "explanation": "x"},
    )
    res = authed_client.post(f"/api/v1/planning/{planning['id']}/build-brief/approve")
    assert any(r["title"] == "New idea" for r in res.json()["accepted_recommendations"])


def test_create_project_builds_real_sitemap_creative_direction_and_design_brief_rows(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Kitchen Renovation")
    planning = _start_planning(authed_client, lead)
    monkeypatch.setattr(
        "app.agents.planning_sitemap_proposal.generate_structured", lambda **kwargs: dict(SITEMAP_PROPOSAL_LLM_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/sitemap/generate")
    monkeypatch.setattr(
        "app.agents.planning_visual_directions.generate_structured", lambda **kwargs: dict(VISUAL_DIRECTIONS_LLM_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/visual-directions/generate")
    authed_client.patch(f"/api/v1/planning/{planning['id']}/visual-directions/select", json={"option_index": 0})
    authed_client.post(f"/api/v1/planning/{planning['id']}/assets/refresh")
    authed_client.post(f"/api/v1/planning/{planning['id']}/build-brief/approve")

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/create-project")
    assert res.status_code == 201
    project = res.json()

    sitemaps = authed_client.get(f"/api/v1/projects/{project['id']}/sitemaps").json()
    assert len(sitemaps) == 1
    assert {p["title"] for p in sitemaps[0]["pages"]} == {"Home", "Services"}

    directions = authed_client.get(f"/api/v1/projects/{project['id']}/creative-directions").json()
    assert len(directions) == 1
    assert directions[0]["visual_direction"] == VISUAL_DIRECTIONS_LLM_OUTPUT["options"][0]["character"]
    assert directions[0]["colour_direction"] == VISUAL_DIRECTIONS_LLM_OUTPUT["options"][0]["colour_palette"]
    assert directions[0]["status"] == "draft"

    assert "Build Brief objective" in project["build_direction"] or project["build_direction"] is not None


# --- Content Draft -----------------------------------------------------

CONTENT_DRAFT_PAGE_OUTPUT = {
    "seo_title": "Kitchen Renovations | Coastal Cafe",
    "seo_meta_description": "Custom kitchen renovations for your home.",
    "sections": [
        {
            "section_type": "hero",
            "content": {"heading": "Custom Kitchen Renovations", "subheading": "Quality craftsmanship, built to last."},
            "needs_confirmation": [],
        },
        {
            "section_type": "faq",
            "content": {"items": []},
            "needs_confirmation": ["Opening hours not confirmed."],
        },
    ],
}

CONTENT_SECTION_OUTPUT = {
    "section_type": "hero",
    "content": {"heading": "Freshly Regenerated Heading", "subheading": "A brand new subheading."},
    "needs_confirmation": [],
}


def _add_sitemap_pages(authed_client, planning_id, titles):
    for title in titles:
        authed_client.post(
            f"/api/v1/planning/{planning_id}/sitemap",
            json={"title": title, "page_type": "custom", "purpose": f"{title} page purpose."},
        )
    return authed_client.get(f"/api/v1/planning/{planning_id}").json()["sitemap_pages"]


def test_generate_content_draft_requires_at_least_one_sitemap_page(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    res = authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    assert res.status_code == 400


def test_generate_content_draft_creates_one_page_per_sitemap_page(authed_client, monkeypatch):
    lead = _create_lead(authed_client, industry="Kitchen Renovation")
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home", "Services"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    assert res.status_code == 200
    assert res.json()["content_draft_status"] == "generating"
    _drain_jobs()

    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    assert body["content_draft_status"] == "completed"
    assert body["content_draft_generated_at"] is not None
    assert body["content_draft_progress_label"] is None
    assert len(body["content_pages"]) == 2
    for page in body["content_pages"]:
        assert page["status"] == "draft"
        assert page["seo_title"] == CONTENT_DRAFT_PAGE_OUTPUT["seo_title"]
        assert len(page["sections"]) == 2
        faq_section = next(s for s in page["sections"] if s["section_type"] == "faq")
        assert faq_section["needs_confirmation_notes"] == ["Opening hours not confirmed."]


def test_generate_content_draft_degrades_gracefully_without_llm(authed_client):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])

    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()

    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    assert body["content_draft_status"] == "needs_review"
    assert body["content_draft_error"] is not None
    assert body["content_pages"] == []


def test_regenerating_content_draft_skips_edited_and_approved_pages(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home", "Services", "Contact"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()

    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    pages_by_title = {p["sitemap_page_id"]: p for p in body["content_pages"]}
    sitemap_by_id = {p["id"]: p["title"] for p in body["sitemap_pages"]}
    home_page = next(p for p in body["content_pages"] if sitemap_by_id[p["sitemap_page_id"]] == "Home")
    services_page = next(p for p in body["content_pages"] if sitemap_by_id[p["sitemap_page_id"]] == "Services")

    hero_section = next(s for s in home_page["sections"] if s["section_type"] == "hero")
    authed_client.patch(
        f"/api/v1/planning/{planning['id']}/content-draft/pages/{home_page['id']}/sections/{hero_section['id']}",
        json={"content": {"heading": "Operator's own heading", "subheading": "Edited by hand."}},
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/pages/{services_page['id']}/approve")

    new_output = dict(CONTENT_DRAFT_PAGE_OUTPUT)
    new_output["seo_title"] = "A completely different regenerated title"
    monkeypatch.setattr("app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(new_output))
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()

    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    by_id = {p["id"]: p for p in body["content_pages"]}
    home_after = by_id[home_page["id"]]
    services_after = by_id[services_page["id"]]
    contact_after = next(p for p in body["content_pages"] if sitemap_by_id[p["sitemap_page_id"]] == "Contact")

    assert home_after["status"] == "edited"
    assert home_after["seo_title"] == CONTENT_DRAFT_PAGE_OUTPUT["seo_title"]  # untouched — not regenerated
    assert services_after["status"] == "approved"
    assert services_after["seo_title"] == CONTENT_DRAFT_PAGE_OUTPUT["seo_title"]  # untouched — not regenerated
    assert contact_after["seo_title"] == new_output["seo_title"]  # still draft — regenerated


def test_update_content_section_reverts_approved_page_to_edited(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()
    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    page = body["content_pages"][0]
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/approve")

    section = page["sections"][0]
    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/sections/{section['id']}",
        json={"content": {"heading": "Edited after approval"}},
    )
    assert res.status_code == 200
    updated_page = res.json()["content_pages"][0]
    assert updated_page["status"] == "edited"
    updated_section = next(s for s in updated_page["sections"] if s["id"] == section["id"])
    assert updated_section["source"] == "operator_edited"
    assert updated_section["content"] == {"heading": "Edited after approval"}


def test_update_content_page_seo_reverts_approved_page_to_edited(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()
    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    page = body["content_pages"][0]
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/approve")

    res = authed_client.patch(
        f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}",
        json={"seo_title": "Operator's own SEO title", "seo_meta_description": "Operator's own meta description."},
    )
    assert res.status_code == 200
    updated_page = res.json()["content_pages"][0]
    assert updated_page["status"] == "edited"
    assert updated_page["seo_title"] == "Operator's own SEO title"
    assert updated_page["seo_meta_description"] == "Operator's own meta description."


def test_regenerate_untouched_section_replaces_immediately(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()
    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    page = body["content_pages"][0]
    hero_section = next(s for s in page["sections"] if s["section_type"] == "hero")

    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_SECTION_OUTPUT)
    )
    res = authed_client.post(
        f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/sections/{hero_section['id']}/regenerate"
    )
    assert res.status_code == 200
    result = res.json()
    assert result["is_preview"] is False
    updated_page = next(p for p in result["planning"]["content_pages"] if p["id"] == page["id"])
    updated_section = next(s for s in updated_page["sections"] if s["id"] == hero_section["id"])
    assert updated_section["content"]["heading"] == "Freshly Regenerated Heading"


def test_regenerate_edited_section_returns_preview_without_persisting(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()
    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    page = body["content_pages"][0]
    hero_section = next(s for s in page["sections"] if s["section_type"] == "hero")

    authed_client.patch(
        f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/sections/{hero_section['id']}",
        json={"content": {"heading": "My own careful edit"}},
    )
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_SECTION_OUTPUT)
    )
    res = authed_client.post(
        f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/sections/{hero_section['id']}/regenerate"
    )
    assert res.status_code == 200
    result = res.json()
    assert result["is_preview"] is True
    assert result["preview"]["candidate_content"]["heading"] == "Freshly Regenerated Heading"

    # Nothing persisted yet — the operator's edit is still there.
    body_after = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    page_after = body_after["content_pages"][0]
    section_after = next(s for s in page_after["sections"] if s["id"] == hero_section["id"])
    assert section_after["content"] == {"heading": "My own careful edit"}

    # Now apply it.
    res = authed_client.post(
        f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/sections/{hero_section['id']}/apply-preview",
        json={"content": result["preview"]["candidate_content"], "needs_confirmation_notes": []},
    )
    assert res.status_code == 200
    applied_page = res.json()["content_pages"][0]
    applied_section = next(s for s in applied_page["sections"] if s["id"] == hero_section["id"])
    assert applied_section["content"]["heading"] == "Freshly Regenerated Heading"
    assert applied_section["source"] == "generated"


def test_approve_content_page_and_stale_flag_on_source_change(authed_client, monkeypatch, db_session):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()
    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    page = body["content_pages"][0]

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/approve")
    assert res.status_code == 200
    approved_page = res.json()["content_pages"][0]
    assert approved_page["status"] == "approved"
    assert approved_page["stale"] is False

    from app.modules.planning.models import LeadPlanning as _LP

    row = db_session.get(_LP, uuid.UUID(planning["id"]))
    row.recommendations_objective = "A brand new objective that changes everything."
    db_session.commit()

    body_after = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    page_after = body_after["content_pages"][0]
    assert page_after["status"] == "approved"  # unchanged — never silently rewritten
    assert page_after["stale"] is True
    assert page_after["sections"] == approved_page["sections"]  # content itself untouched


def test_content_draft_endpoints_are_workspace_scoped(authed_client, other_authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])

    res = other_authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    assert res.status_code == 404


def test_create_project_handoff_includes_approved_content_draft(authed_client, monkeypatch, db_session):
    lead = _create_lead(authed_client, industry="Kitchen Renovation")
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()
    body = authed_client.get(f"/api/v1/planning/{planning['id']}").json()
    page = body["content_pages"][0]
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/approve")
    authed_client.post(f"/api/v1/planning/{planning['id']}/build-brief/approve")

    res = authed_client.post(f"/api/v1/planning/{planning['id']}/create-project")
    assert res.status_code == 201
    project = res.json()
    assert "Content Draft" in project["build_direction"]
    assert "Opening hours not confirmed." in project["build_direction"]

    sitemaps = authed_client.get(f"/api/v1/projects/{project['id']}/sitemaps").json()
    home = next(p for p in sitemaps[0]["pages"] if p["title"] == "Home")

    from app.modules.sitemaps.models import SitemapPage as _RealSitemapPage

    real_page = db_session.get(_RealSitemapPage, uuid.UUID(home["id"]))
    assert real_page.seo_title == CONTENT_DRAFT_PAGE_OUTPUT["seo_title"]
    assert real_page.seo_meta_description == CONTENT_DRAFT_PAGE_OUTPUT["seo_meta_description"]

    from app.modules.design_briefs.models import DesignBrief as _DesignBrief

    design_brief = db_session.query(_DesignBrief).filter_by(project_id=uuid.UUID(project["id"])).first()
    assert design_brief.business_description == CONTENT_DRAFT_PAGE_OUTPUT["sections"][0]["content"]["subheading"]


def test_create_project_handoff_prefills_brief_but_keeps_planning_copy(authed_client, monkeypatch):
    """Planning's handoff creates the project's DesignBrief itself, so the
    normal "pre-fill a new brief" path never runs — the handoff must top up
    the still-empty business fields from the lead, without displacing the
    copy Planning already put in the brief."""
    lead = _create_lead(authed_client, industry="Kitchen Renovation", phone="07 5555 1234")
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"notes": "Lead notes that must not win."})
    planning = _start_planning(authed_client, lead)
    _add_sitemap_pages(authed_client, planning["id"], ["Home"])
    monkeypatch.setattr(
        "app.agents.planning_content_draft.generate_structured", lambda **kwargs: dict(CONTENT_DRAFT_PAGE_OUTPUT)
    )
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/generate")
    _drain_jobs()
    page = authed_client.get(f"/api/v1/planning/{planning['id']}").json()["content_pages"][0]
    authed_client.post(f"/api/v1/planning/{planning['id']}/content-draft/pages/{page['id']}/approve")
    authed_client.post(f"/api/v1/planning/{planning['id']}/build-brief/approve")

    project = authed_client.post(f"/api/v1/planning/{planning['id']}/create-project").json()
    assert project["client_id"] is None

    fields = authed_client.get(f"/api/v1/projects/{project['id']}/brief").json()["business"]["fields"]
    assert fields["business_description"] == CONTENT_DRAFT_PAGE_OUTPUT["sections"][0]["content"]["subheading"]
    assert fields["business_name"] == "Coastal Cafe"
    assert fields["industry"] == "Kitchen Renovation"
    assert fields["location"] == "Byron Bay, NSW"
    assert fields["contact_phone"] == "07 5555 1234"


def test_create_project_handoff_prefills_brief_with_no_content_draft(authed_client):
    lead = _create_lead(authed_client, industry="Kitchen Renovation")
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"notes": "Owner wants online quotes."})
    planning = _start_planning(authed_client, lead)
    authed_client.post(f"/api/v1/planning/{planning['id']}/build-brief/approve")

    project = authed_client.post(f"/api/v1/planning/{planning['id']}/create-project").json()

    fields = authed_client.get(f"/api/v1/projects/{project['id']}/brief").json()["business"]["fields"]
    assert fields["business_name"] == "Coastal Cafe"
    assert fields["industry"] == "Kitchen Renovation"
    assert "Owner wants online quotes." in fields["business_description"]
