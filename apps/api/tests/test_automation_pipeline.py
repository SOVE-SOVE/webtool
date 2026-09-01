"""
Phase 7 Part 3 checkpoint: "connect the major automation systems." Every
other workflow test (`test_end_to_end_workflow.py`,
`test_lead_intelligence_workflow.py`) drives the pipeline by calling one
manual route per stage. This file proves the *automation* layer added on
top of those same service functions: registering a job handler
(`app/jobs/handlers.py`) plus an `enqueue` call at the right completion
point turns several of those manual clicks into something that happens
on its own once the job queue is drained — while the stages that must
stay a human decision (importing a discovered business, sending
outreach, winning/closing a deal, approving website content, deploying)
still refuse to happen without an explicit operator action, exactly as
before this pass.

`test_full_pipeline_discovery_to_deployment_with_automation` is one long
walk for the same reason `test_all_22_stages_with_invariants` is: a
hand-off that only fires manually, or fires twice, only shows up when
the chain runs continuously with nothing skipped.
"""

from app.integrations import search as search_integration
from app.integrations.browser import PageSignals, ResearchPageSignals
from app.integrations.llm import LlmUnavailableError
from app.integrations.search import SearchResult
from app.jobs import runner
from app.jobs.handlers import HANDLERS
from app.modules.jobs.models import JobStatus

CREATIVE_DIRECTION_LLM_OUTPUT = {
    "facts": ["Gold Coast Plumbing Co is a residential plumbing business."],
    "assumptions": [],
    "creative_concept": "A dependable, no-nonsense local tradie brand.",
    "visual_direction": "Clean, high-contrast, utilitarian.",
    "brand_personality": ["Trustworthy", "Prompt"],
    "colour_direction": "Deep blue with an amber accent.",
    "typography_direction": "A confident, legible sans-serif.",
    "image_direction": "Real photos of the crew and completed jobs.",
    "layout_direction": "Short, scannable homepage.",
    "ux_direction": "One-tap call button pinned on mobile.",
    "tone_of_voice": "Plain-spoken, direct.",
    "visual_hierarchy": "Phone number first, services second.",
    "cta_strategy": "Primary CTA is 'Call now', repeated throughout.",
    "things_to_avoid": ["Generic corporate stock photos"],
    "references_inspiration": ["Local trade-service sites"],
}

SITEMAP_LLM_OUTPUT = {
    "overview": "A compact site for a residential plumber.",
    "pages": [
        {
            "title": "Home", "slug": "", "page_type": "home", "parent_slug": None,
            "nav_placement": "primary_nav", "purpose": "Convert a visitor into a phone call.",
            "primary_cta": "Get a quote", "secondary_cta": None,
            "key_sections": ["Hero"], "required_content": [], "required_functionality": [],
        },
        {
            "title": "Contact", "slug": "contact", "page_type": "contact", "parent_slug": None,
            "nav_placement": "primary_and_footer", "purpose": "Let a visitor get in touch.",
            "primary_cta": "Get a quote", "secondary_cta": None,
            "key_sections": [], "required_content": [], "required_functionality": [],
        },
    ],
}

SALES_AUDIT_LLM_OUTPUT = {
    "business_summary": "Gold Coast Plumbing Co is a residential plumbing business.",
    "website_strengths": [],
    "top_problems": ["No HTTPS", "No mobile viewport meta tag"],
    "why_problems_matter": ["Visitors on phones may see a broken layout"],
    "recommended_improvements": ["Rebuild on a modern, mobile-first template"],
    "suggested_structure": ["Home", "Services", "About", "Contact"],
    "talking_points": ["Your site isn't served over HTTPS."],
    "potential_objections": ["\"My current site is fine\" — it loads, but it isn't secure."],
    "suggested_offer": "Core tier (~$899) fits a small trade-business rebuild.",
}

FAKE_EMAIL_OUTPUT = {
    "subject": "Quick note about your website",
    "opening_line": "Noticed your site isn't served over HTTPS.",
    "body": "Full email body here.",
    "key_points": ["No HTTPS"],
    "objection_handling": ["Handles the 'my site is fine' objection"],
    "suggested_close": "Keen for a quick call this week?",
}

FOLLOW_UP_LLM_OUTPUT = {
    "channel": "email",
    "due_in_days": 4,
    "suggested_next_action": "Send a short nudge referencing the HTTPS issue.",
}

_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Gold Coast since 2012.",
    "contact_email": "hello@gcplumbing.example",
    "testimonials": "Fast, tidy, and fairly priced. — Priya K.",
    "calls_to_action": "Get a quote",
}


def _boom(**kwargs):
    raise LlmUnavailableError("AI generation is unavailable — simulated failure. Nothing was generated or saved.")


def _patch_all_llm_agents(monkeypatch):
    """Every LLM-backed agent this pipeline touches, stubbed to a fixed
    output — the automation being tested is *whether the right job fires
    at the right time*, not the LLM output itself, which every other
    module's own tests already cover."""
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(SALES_AUDIT_LLM_OUTPUT))
    monkeypatch.setattr("app.agents.outreach.generate_structured", lambda **kwargs: dict(FAKE_EMAIL_OUTPUT))
    monkeypatch.setattr("app.agents.follow_up.generate_structured", lambda **kwargs: dict(FOLLOW_UP_LLM_OUTPUT))
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(SITEMAP_LLM_OUTPUT))


def _patch_discovery_and_research(monkeypatch, *, https=False, mobile_viewport_present=False):
    """Same fixture shape as test_lead_intelligence_workflow.py — a
    "hot" opportunity (an existing, reachable, but insecure/non-mobile
    site) so the automated score/category is predictable."""
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Gold Coast Plumbing Co", url="https://gcplumbing.example", description="Local plumbers")
        ],
    )

    async def fake_research_fetch(url):
        return ResearchPageSignals(
            final_url=url,
            https=https,
            http_status=200,
            title="Gold Coast Plumbing Co",
            meta_description="Local plumbers",
            viewport_meta_present=mobile_viewport_present,
            mobile_overflow=False,
            contact_cta_present=False,
            social_links=[],
            body_text="Copyright 2019 Gold Coast Plumbing Co",
            load_time_ms=5000,
        )

    monkeypatch.setattr("app.agents.business_research.fetch_research_signals", fake_research_fetch)

    async def fake_audit_fetch(url):
        return PageSignals(
            final_url=url, https=https, http_status=200, title="Gold Coast Plumbing Co",
            meta_description="Local plumbers", viewport_meta_present=mobile_viewport_present,
            mobile_overflow=True, load_time_ms=5000,
        )

    # The lead-side sales audit (a *different* agent/table from
    # discovery-side research) fetches independently — see
    # docs/05_DECISIONS.md on why M2 and M7 each have their own audit
    # path rather than sharing one.
    monkeypatch.setattr("app.agents.website_audit.fetch_page_signals", fake_audit_fetch)


def _drain_jobs(max_jobs: int = 50) -> int:
    """
    Runs the real poller loop (`app.jobs.runner.run_once`) against the
    real registered handlers until the queue is empty — the same
    function `python -m app.jobs.runner` calls in a real deployment, so
    this proves the actual wiring, not a test-only shortcut. Bounded so
    a bug that keeps re-enqueueing (an infinite chain) fails the test
    loudly instead of hanging it.
    """
    count = 0
    while runner.run_once(HANDLERS):
        count += 1
        assert count <= max_jobs, "job queue did not settle — possible infinite requeue loop"
    return count


def test_full_pipeline_discovery_to_deployment_with_automation(authed_client, db_session, monkeypatch):
    _patch_discovery_and_research(monkeypatch)
    _patch_all_llm_agents(monkeypatch)
    monkeypatch.setattr("app.core.rate_limit.settings.llm_rate_limit_per_minute", 1000)

    # ---------------------------------------------------------------
    # 1. SCHEDULED DISCOVERY -> RESEARCH -> ANALYSIS -> SCORING, fully
    #    automatic. Only the search itself is operator-initiated (a
    #    scheduled/recurring run is covered separately below); the
    #    research -> quality-audit -> score chain that follows fires on
    #    its own via the job queue with no further POSTs.
    # ---------------------------------------------------------------
    search = authed_client.post(
        "/api/v1/discovery-searches", json={"industry": "Plumbing", "location": "Gold Coast"}
    ).json()
    business = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()[0]
    business_id = business["id"]

    # Nothing has run yet — a job is only queued, not processed inline.
    assert business["status"] == "new"
    assert authed_client.get(f"/api/v1/discovered-businesses/{business_id}").json()["status"] == "new"

    jobs_run = _drain_jobs()
    assert jobs_run == 3  # business_research -> website_quality_audit -> opportunity_score

    scored = authed_client.get(f"/api/v1/discovered-businesses/{business_id}").json()
    assert scored["status"] == "scored"
    assert scored["opportunity_score"] is not None
    assert scored["score_category"] == "hot"

    review_row = next(r for r in authed_client.get("/api/v1/discovered-businesses").json() if r["id"] == business_id)
    assert review_row["researched_at"] is not None
    assert review_row["quality_summary"]
    assert review_row["confidence"] is not None

    # ---------------------------------------------------------------
    # SAFETY INVARIANT — importing a discovered business into the CRM
    #     never happens on its own, "hot" opportunity or not. Every
    #     prospect, questionable or not, waits for an explicit human
    #     review + import action.
    # ---------------------------------------------------------------
    assert scored["status"] != "imported"
    assert scored["imported_lead_id"] is None

    # ---------------------------------------------------------------
    # 2. HUMAN REVIEW + CRM IMPORT — unchanged, explicit operator action.
    # ---------------------------------------------------------------
    approved = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/approve").json()
    # Approving a reviewed prospect now brings it straight into the CRM.
    assert approved["status"] == "imported"
    lead_id = approved["imported_lead_id"]
    assert lead_id is not None

    # ---------------------------------------------------------------
    # 3. SALES PREP (manual, existing feature) -> OUTREACH ASSISTANCE,
    #    now automatic: generating a sales audit is still an explicit
    #    operator action, but it now hands off to an outreach *draft* on
    #    its own — drafting only, never sent.
    # ---------------------------------------------------------------
    audit = authed_client.post(f"/api/v1/leads/{lead_id}/sales-audits").json()
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "researched"
    assert authed_client.get(f"/api/v1/leads/{lead_id}/outreach").json() == []  # job not yet processed

    jobs_run = _drain_jobs()
    assert jobs_run == 1  # outreach_draft

    outreach_list = authed_client.get(f"/api/v1/leads/{lead_id}/outreach").json()
    assert len(outreach_list) == 1
    outreach = outreach_list[0]
    assert outreach["status"] == "drafted"
    assert outreach["channel"] == "email"
    assert outreach["based_on_sales_audit_id"] == audit["id"]

    # Re-generating the sales audit for the same lead must not pile up a
    # second outreach draft — the handler's own dedup guard.
    authed_client.post(f"/api/v1/leads/{lead_id}/sales-audits")
    _drain_jobs()
    assert len(authed_client.get(f"/api/v1/leads/{lead_id}/outreach").json()) == 1

    # ---------------------------------------------------------------
    # SAFETY INVARIANT — a drafted (even an approved) message is never
    #     sent by anything but an explicit operator action.
    # ---------------------------------------------------------------
    assert outreach["status"] == "drafted"
    authed_client.post(f"/api/v1/outreach/{outreach['id']}/approve")
    assert authed_client.get(f"/api/v1/outreach/{outreach['id']}").json()["status"] == "approved"
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "researched"  # not contacted yet

    # ---------------------------------------------------------------
    # 4. MARK SENT (manual, required) -> FOLLOW-UP, now automatic.
    # ---------------------------------------------------------------
    authed_client.post(f"/api/v1/outreach/{outreach['id']}/mark-sent")
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "contacted"
    assert authed_client.get("/api/v1/follow-ups").json() == {"overdue": [], "due_today": [], "upcoming": []}

    jobs_run = _drain_jobs()
    assert jobs_run == 1  # follow_up_draft

    buckets = authed_client.get("/api/v1/follow-ups").json()
    pending_ids = {f["id"] for bucket in buckets.values() for f in bucket}
    assert len(pending_ids) == 1

    # ---------------------------------------------------------------
    # 5. MEETING (manual, existing automatic side effects unchanged) ->
    #    6. WON / CLIENT / PROJECT — human-gated per the requirements
    #    ("winning/closing deals" always requires approval).
    # ---------------------------------------------------------------
    authed_client.post(
        "/api/v1/meetings", json={"title": "Discovery call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id}
    )
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "meeting"

    client = authed_client.post(
        "/api/v1/clients",
        json={"from_lead_id": lead_id, "package": "core", "won_price_cents": 89900, "project_name": "GC Plumbing Site"},
    ).json()
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "won"
    project = next(p for p in authed_client.get("/api/v1/projects").json() if p["client_id"] == client["id"])
    project_id = project["id"]

    # ---------------------------------------------------------------
    # 7. INTAKE BRIEF (manual) -> 8. CREATIVE DIRECTION (manual generate
    #    + approve, LLM-backed).
    # ---------------------------------------------------------------
    authed_client.patch(f"/api/v1/projects/{project_id}/brief", json=_REAL_BRIEF)
    authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")

    cd = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions").json()
    authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "design"

    # ---------------------------------------------------------------
    # 9. SITEMAP generated (manual, LLM-backed) then approved (manual) ->
    #    WEBSITE GENERATION and QA now run automatically, with no
    #    "Generate website" / "Run QA" click needed.
    # ---------------------------------------------------------------
    sitemap = authed_client.post(f"/api/v1/projects/{project_id}/sitemaps").json()
    assert authed_client.get(f"/api/v1/projects/{project_id}/websites").json() == []

    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    assert authed_client.get(f"/api/v1/projects/{project_id}/websites").json() == []  # job not yet processed

    jobs_run = _drain_jobs()
    assert jobs_run == 2  # website_generate -> qa_report

    websites = authed_client.get(f"/api/v1/projects/{project_id}/websites").json()
    assert len(websites) == 1
    website = authed_client.get(f"/api/v1/websites/{websites[0]['id']}").json()
    assert website["pages"]
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "development"

    qa_reports = authed_client.get(f"/api/v1/websites/{website['id']}/qa-reports").json()
    assert len(qa_reports) == 1
    qa = authed_client.get(f"/api/v1/qa-reports/{qa_reports[0]['id']}").json()
    assert qa["passed"] is True

    # ---------------------------------------------------------------
    # 10. CLIENT-REVIEW-READY REMINDER — an internal task, never a
    #     message to the client (that stays a human call per
    #     docs/03_AGENT_RULES.md's "client approval communication").
    # ---------------------------------------------------------------
    project_tasks = [t for t in authed_client.get("/api/v1/tasks").json() if t["project_id"] == project_id]
    assert any(t["title"] == "Request client review" and not t["done"] for t in project_tasks)

    # A second QA run (e.g. after a content edit) must not stack up a
    # second reminder while the first is still open — this becomes the
    # new latest report, so the rest of the approval chain below signs
    # off on it rather than the stale first one.
    qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
    reminder_count = len(
        [
            t
            for t in authed_client.get("/api/v1/tasks").json()
            if t["project_id"] == project_id and t["title"] == "Request client review"
        ]
    )
    assert reminder_count == 1

    # ---------------------------------------------------------------
    # SAFETY INVARIANT — nothing above approved website content or
    #     deployed anything. Every prerequisite checkpoint still has to
    #     be satisfied by an explicit human action, exactly as before
    #     this pass.
    # ---------------------------------------------------------------
    deploy_attempt = authed_client.post(f"/api/v1/projects/{project_id}/deployments")
    assert deploy_attempt.status_code == 400
    assert "Generated website" in deploy_attempt.json()["detail"]
    assert "QA" in deploy_attempt.json()["detail"]
    assert "Client review" in deploy_attempt.json()["detail"]

    # ---------------------------------------------------------------
    # 11. HUMAN APPROVAL CHAIN — content, QA sign-off, client review —
    #     all still explicit operator actions.
    # ---------------------------------------------------------------
    authed_client.post(f"/api/v1/websites/{website['id']}/approve")
    authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")
    authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "ready_to_deploy"

    # Phase 6 Task 3's formal approval workflow — a separate, explicit,
    # still entirely operator-driven gate `create_deployment` requires
    # independently of the seven boolean checkpoints above. Automation
    # never drives this on its own either.
    for to_status in ("internal_review", "client_review", "approved", "ready_to_deploy"):
        res = authed_client.post(f"/api/v1/websites/{website['id']}/workflow-transition", json={"to_status": to_status})
        assert res.status_code == 200

    approvals = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
    assert approvals["can_deploy"] is True
    assert approvals["missing_for_deployment"] == []

    # ---------------------------------------------------------------
    # 12. DEPLOYMENT — prepare and execute, both still explicit,
    #     human-gated actions ("deploying websites" always requires
    #     approval). 13. DELIVERY — the launch-task checklist is seeded
    #     automatically off the real deployment, same as before this
    #     pass; nothing here changes that.
    # ---------------------------------------------------------------
    deployment = authed_client.post(f"/api/v1/projects/{project_id}/deployments").json()
    assert deployment["status"] == "pending"
    executed = authed_client.post(f"/api/v1/deployments/{deployment['id']}/execute").json()
    assert executed["status"] == "success"
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "deployed"

    # No stray jobs left behind anywhere in the run.
    assert _drain_jobs() == 0


def test_scheduled_discovery_reruns_and_reschedules_itself(authed_client, monkeypatch):
    """
    "Scheduled discovery" — an operator configures a recurring search
    once; it runs on its own on a fixed cadence from then on, without a
    human re-triggering it, via the job queue's own `run_after`
    (app/jobs/handlers.py::handle_discovery_search) rather than a
    separate scheduler process.
    """
    _patch_discovery_and_research(monkeypatch)

    scheduled = authed_client.post(
        "/api/v1/discovery-searches/schedule",
        json={"industry": "Plumbing", "location": "Gold Coast", "interval_hours": 6},
    )
    assert scheduled.status_code == 201
    assert scheduled.json()["payload"]["recurring"] is True
    assert scheduled.json()["payload"]["interval_hours"] == 6

    pending = authed_client.get("/api/v1/discovery-searches/schedule").json()
    assert len(pending) == 1
    first_run_after = pending[0]["run_after"]

    # Draining once should run the search itself, chain into
    # research/audit/score for whatever it found, AND leave exactly one
    # new pending discovery_search job scheduled ~6h out — never zero
    # (the recurrence dying) and never more than one (double-scheduling).
    jobs_run = _drain_jobs()
    assert jobs_run >= 1

    searches = authed_client.get("/api/v1/discovery-searches").json()
    assert len(searches) == 1
    assert searches[0]["status"] == "completed"

    rescheduled = authed_client.get("/api/v1/discovery-searches/schedule").json()
    assert len(rescheduled) == 1
    assert rescheduled[0]["run_after"] != first_run_after  # a genuinely new future run, not the same row


def test_recurring_discovery_survives_a_provider_failure(authed_client, monkeypatch):
    """A provider outage on one scheduled run must not silently kill the
    recurrence — it retries via the queue's own attempt cap, and the
    self-reschedule still happens so the *next* cycle isn't lost too."""
    from app.integrations.discovery.base import ProviderUnavailableError

    def boom(*args, **kwargs):
        raise ProviderUnavailableError("provider is down")

    monkeypatch.setattr(search_integration, "search_business", boom)

    authed_client.post(
        "/api/v1/discovery-searches/schedule", json={"industry": "Plumbing", "interval_hours": 12}
    )
    _drain_jobs()

    searches = authed_client.get("/api/v1/discovery-searches").json()
    assert searches[0]["status"] == "failed"

    rescheduled = authed_client.get("/api/v1/discovery-searches/schedule").json()
    assert len(rescheduled) == 1  # still rescheduled despite the failure
