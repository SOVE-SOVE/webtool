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
from app.integrations.browser import PlanningAuditSignals
from app.integrations.llm import LlmUnavailableError
from app.jobs import runner
from app.jobs.handlers import HANDLERS

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
    async def fake_fetch(url):
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

    async def _raise_fetch(url):
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
    lead = _create_lead(authed_client)
    _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    items = authed_client.get("/api/v1/planning").json()
    assert len(items) == 1
    assert items[0]["lead_business_name"] == "Coastal Cafe"
    assert "screenshot_desktop_base64" not in items[0]


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


def test_create_project_from_planning_carries_forward_summary_and_points(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")

    res = authed_client.post(f"/api/v1/planning/{result['id']}/create-project")
    assert res.status_code == 201
    project = res.json()
    assert project["source_lead_id"] == lead["id"]
    assert SUMMARY_LLM_OUTPUT["website_summary"] in project["build_direction"]
    assert "Key points:" in project["build_direction"]

    lead_after = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert lead_after["status"] == "won"


def test_create_project_from_planning_returns_404_for_missing_item(authed_client):
    res = authed_client.post(f"/api/v1/planning/{uuid.uuid4()}/create-project")
    assert res.status_code == 404


def test_create_project_from_planning_conflicts_if_lead_already_converted(authed_client, monkeypatch):
    lead = _create_lead(authed_client)
    result = _start_and_analyse(authed_client, monkeypatch, lead, website_url="https://coastalcafe.example")
    authed_client.post(f"/api/v1/planning/{result['id']}/create-project")

    res = authed_client.post(f"/api/v1/planning/{result['id']}/create-project")
    assert res.status_code == 409


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
