"""
Integration coverage for the full pipeline end to end: LEAD -> RESEARCH
-> OUTREACH -> FOLLOW-UP -> MEETING -> WON -> CLIENT/PROJECT -> INTAKE ->
CREATIVE DIRECTION -> SITEMAP -> WEBSITE -> ANTI-SLOP -> QA -> CLIENT
REVIEW -> APPROVAL -> DEPLOYMENT -> MAINTENANCE. Every other test file
exercises one module in isolation (fixtures start from
`_create_project_without_lead`, bypassing the sales side entirely); this
file is the one place a real `Lead` row is walked all the way through to
a deployed website, checking that information actually flows forward
(lead status, project stage, activity log, pipeline_events) rather than
each module just working in isolation.

`test_all_22_stages_with_invariants` is deliberately one long test
rather than several: the point is that each stage's output is the next
stage's input, and a handoff that breaks in the middle only shows up
when the chain is walked continuously. Alongside the stage walk it
asserts the four standing invariants from docs/00_VISION.md /
docs/03_AGENT_RULES.md:

  1. Never claim an action occurred when it did not — a failed
     generation is a 503 with nothing stored, not a 201 with a body; a
     mock deployment says so in its own result.
  2. Never fabricate client information — content the operator can't
     trace to the brief is flagged by agents/anti_slop.py.
  3. Never deploy without the required approvals — each of the six
     prerequisite checkpoints is refused by name while it's missing.
  4. Keep an auditable history — every stage transition lands in
     activity_log and/or pipeline_events.
"""

from app.integrations.browser import PageSignals
from app.integrations.llm import LlmUnavailableError
from app.integrations.search import SearchResult
from app.modules.pipeline.models import PipelineEvent
from app.modules.projects.service import DEFAULT_INTAKE_TASK_TITLES, DEFAULT_LAUNCH_TASK_TITLES

CREATIVE_DIRECTION_LLM_OUTPUT = {
    "facts": ["Riverside Plumbing is a residential plumbing business."],
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
    "business_summary": "Riverside Plumbing is a residential plumbing business in Geelong, VIC.",
    "website_strengths": ["Uses HTTPS"],
    "top_problems": ["No mobile viewport meta tag"],
    "why_problems_matter": ["Visitors on phones may see a broken layout"],
    "recommended_improvements": ["Add a responsive layout"],
    "suggested_structure": ["Home", "Services", "About", "Contact"],
    "talking_points": ["Your site isn't showing a mobile-friendly viewport tag."],
    "potential_objections": ["\"My current site is fine\" — it loads, but the layout has issues."],
    "suggested_offer": "Core tier (~$899) fits a small trade-business rebuild.",
}

FAKE_EMAIL_OUTPUT = {
    "subject": "Quick note about riversideplumbing.example",
    "opening_line": "Noticed your site isn't mobile-friendly.",
    "body": "Full email body here.",
    "key_points": ["Mobile-friendliness"],
    "objection_handling": ["Handles the 'my site is fine' objection"],
    "suggested_close": "Keen for a quick call this week?",
}

FOLLOW_UP_LLM_OUTPUT = {
    "channel": "email",
    "due_in_days": 4,
    "suggested_next_action": "Send a short nudge referencing the mobile issue.",
}

MEETING_BRIEF_LLM_OUTPUT = {
    "questions_to_ask": ["Who currently answers the phone for quotes?"],
    "likely_requirements": ["A one-tap call button"],
}

_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "contact_email": "hello@riversideplumbing.com.au",
    "testimonials": "They fixed a burst pipe the same afternoon. — Sam T.",
    "calls_to_action": "Get a quote",
}


def _boom(**kwargs):
    """Stands in for any LLM call that can't complete — the same error
    integrations/llm.py raises for a missing key, no credit, or an
    unreachable API."""
    raise LlmUnavailableError("AI generation is unavailable — simulated failure. Nothing was generated or saved.")


def _patch_research(monkeypatch):
    async def fake_fetch(url):
        return PageSignals(
            final_url=url, https=True, http_status=200, title="Riverside Plumbing",
            meta_description="Local plumbing services", viewport_meta_present=False,
            mobile_overflow=True, load_time_ms=850,
        )

    monkeypatch.setattr("app.agents.website_audit.fetch_page_signals", fake_fetch)
    monkeypatch.setattr(
        "app.integrations.search.search_business",
        lambda query: [SearchResult(title="Riverside Plumbing", url="https://example.com", description="Plumber")],
    )


def _all_hrefs(node):
    """Every href anywhere in a generated config, however nested."""
    found = []
    if isinstance(node, dict):
        if isinstance(node.get("href"), str):
            found.append(node["href"])
        for value in node.values():
            found.extend(_all_hrefs(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_all_hrefs(item))
    return found


def test_all_22_stages_with_invariants(authed_client, db_session, monkeypatch):
    _patch_research(monkeypatch)
    # Every paid-generation route is rate limited per user per minute
    # (app/core/rate_limit.py, default 10). One project's whole pipeline
    # legitimately makes more calls than that in the seconds this test
    # takes, so the cap is raised here rather than worked around — it's
    # a cost control, not a pipeline rule, and test_rate_limit.py owns
    # proving it works.
    monkeypatch.setattr("app.core.rate_limit.settings.llm_rate_limit_per_minute", 1000)

    # ---------------------------------------------------------------
    # 1. LEAD DISCOVERED — manual entry by design. There is no scraper
    #    or data feed in this system (docs/00_VISION.md); POST /leads is
    #    the only way a lead exists, and the operator decides who's worth
    #    pursuing.
    # ---------------------------------------------------------------
    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Riverside Plumbing", "suburb": "Geelong", "state": "VIC"}
    ).json()
    lead_id = lead["id"]
    assert lead["status"] == "new"
    assert lead["score"] is None
    authed_client.patch(
        f"/api/v1/businesses/{lead['business_id']}", json={"website_url": "https://riversideplumbing.example"}
    )

    # ---------------------------------------------------------------
    # INVARIANT 1 — a failed generation is never reported as a success.
    #    Stages 2-5 (research, website analysis, scoring, sales audit)
    #    all run inside this one route and one transaction, so an LLM
    #    failure at the last step must leave *nothing* behind: no
    #    website_audits row, no lead score, no status bump, no activity.
    # ---------------------------------------------------------------
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", _boom)
    failed = authed_client.post(f"/api/v1/leads/{lead_id}/sales-audits")
    assert failed.status_code == 503
    assert "unavailable" in failed.json()["detail"]
    assert authed_client.get(f"/api/v1/leads/{lead_id}/website-audits").json() == []
    assert authed_client.get(f"/api/v1/leads/{lead_id}/sales-audits").json() == []
    unchanged = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert unchanged["status"] == "new" and unchanged["score"] is None
    assert [a["action"] for a in _lead_activity(authed_client, lead_id)] == ["created"]

    # ---------------------------------------------------------------
    # 2-5. LEAD RESEARCHED / WEBSITE ANALYSED / LEAD SCORED / SALES
    #      AUDIT GENERATED — one operator action. The website audit is
    #      deterministic (a real browser fetch), the score is
    #      deterministic rules over that audit, and only the written
    #      audit is LLM-drafted.
    # ---------------------------------------------------------------
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(SALES_AUDIT_LLM_OUTPUT))
    audit = authed_client.post(f"/api/v1/leads/{lead_id}/sales-audits").json()
    assert audit["website_audit"]["has_existing_site"] is True
    assert audit["suggested_offer"] == SALES_AUDIT_LLM_OUTPUT["suggested_offer"]
    # The audit carries its own provenance forward, so a later reader can
    # tell what it was actually built from.
    assert "riversideplumbing.example" in audit["sources_note"]

    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead["status"] == "researched"  # leads_service.mark_researched
    assert lead["score"] is not None  # agents/lead_score.py

    # ---------------------------------------------------------------
    # 6. OUTREACH PREPARED — drafted from the sales audit. Sending is
    #    never automated: generating and even approving a draft must not
    #    move the lead or the message past the operator.
    # ---------------------------------------------------------------
    monkeypatch.setattr("app.agents.outreach.generate_structured", lambda **kwargs: dict(FAKE_EMAIL_OUTPUT))
    outreach = authed_client.post(f"/api/v1/leads/{lead_id}/outreach", json={"channel": "email"}).json()
    assert outreach["subject"] == FAKE_EMAIL_OUTPUT["subject"]
    assert outreach["status"] == "drafted"
    assert outreach["based_on_sales_audit_id"] == audit["id"]  # provenance carries forward

    authed_client.post(f"/api/v1/outreach/{outreach['id']}/approve")
    assert authed_client.get(f"/api/v1/outreach/{outreach['id']}").json()["status"] == "approved"
    # Approving is not sending — nothing left this system, so the lead
    # has not been contacted.
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "researched"

    authed_client.post(f"/api/v1/outreach/{outreach['id']}/mark-sent")
    # Marking sent is the operator saying "I sent it" — bookkeeping only,
    # but it's the funnel event, so the status follows on its own rather
    # than needing a second manual edit (docs/05_DECISIONS.md 2026-08-21).
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "contacted"

    # ---------------------------------------------------------------
    # 7. FOLLOW-UP SCHEDULED — suggested by the LLM, resolved only by an
    #    explicit operator action. Nothing else in the system may quietly
    #    close a pending follow-up, or a real one would disappear off the
    #    dashboard unactioned.
    # ---------------------------------------------------------------
    monkeypatch.setattr("app.agents.follow_up.generate_structured", lambda **kwargs: dict(FOLLOW_UP_LLM_OUTPUT))
    follow_up = authed_client.post(f"/api/v1/leads/{lead_id}/follow-ups").json()
    assert follow_up["status"] == "pending"
    assert follow_up["previous_outreach"]["id"] == outreach["id"]  # links back to what it follows up on
    assert follow_up["id"] in _pending_follow_up_ids(authed_client)

    authed_client.post(f"/api/v1/outreach/{outreach['id']}/mark-replied")
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "replied"
    # A reply arriving is NOT the follow-up being done — only the
    # operator closes it.
    assert follow_up["id"] in _pending_follow_up_ids(authed_client)

    resolved = authed_client.post(f"/api/v1/follow-ups/{follow_up['id']}/resolve").json()
    assert resolved["status"] == "done" and resolved["resolved_by_user_name"] is not None
    assert follow_up["id"] not in _pending_follow_up_ids(authed_client)

    # ---------------------------------------------------------------
    # 8. MEETING BOOKED — the forward-only guard has to compose with the
    #    statuses pass 4 made reachable: a REPLIED lead still advances.
    # 9. MEETING BRIEFING GENERATED — the one generator that degrades
    #    instead of failing. With no LLM key the factual sections are
    #    still assembled from stored records; only the discovery
    #    questions are missing, and the brief says so.
    # ---------------------------------------------------------------
    meeting = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Discovery call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    ).json()
    assert meeting["meeting_type"] == "sales_call"
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "meeting"

    brief_no_llm = meeting["brief"]
    assert brief_no_llm is not None
    assert brief_no_llm["business_name"] == "Riverside Plumbing"
    # Facts came from the sales audit, not the model.
    assert brief_no_llm["website_weaknesses"] == SALES_AUDIT_LLM_OUTPUT["top_problems"]
    assert brief_no_llm["possible_package"] == SALES_AUDIT_LLM_OUTPUT["suggested_offer"]
    assert brief_no_llm["suggested_pricing_range"] == "Core (~$899)"
    assert brief_no_llm["questions_to_ask"] == []
    assert brief_no_llm["flagged_for_review"] is True
    assert "No LLM configured" in brief_no_llm["review_notes"]

    # With a key configured, the discovery half fills in.
    monkeypatch.setattr("app.core.settings.settings.llm_api_key", "test-key-not-a-real-credential")
    monkeypatch.setattr("app.agents.meeting_brief.generate_structured", lambda **kw: dict(MEETING_BRIEF_LLM_OUTPUT))
    regenerated = authed_client.post(f"/api/v1/meetings/{meeting['id']}/brief").json()["brief"]
    assert regenerated["questions_to_ask"] == MEETING_BRIEF_LLM_OUTPUT["questions_to_ask"]
    assert regenerated["likely_requirements"] == MEETING_BRIEF_LLM_OUTPUT["likely_requirements"]
    assert regenerated["business_name"] == "Riverside Plumbing"

    # And with a key configured but the API failing, it degrades rather
    # than 503-ing the booking — the facts are worth having on their own.
    monkeypatch.setattr("app.agents.meeting_brief.generate_structured", _boom)
    degraded_res = authed_client.post(f"/api/v1/meetings/{meeting['id']}/brief")
    assert degraded_res.status_code == 200
    degraded = degraded_res.json()["brief"]
    assert degraded["questions_to_ask"] == []
    assert degraded["flagged_for_review"] is True
    assert "failed" in degraded["review_notes"]
    assert degraded["website_weaknesses"] == SALES_AUDIT_LLM_OUTPUT["top_problems"]  # facts unaffected

    # ---------------------------------------------------------------
    # 10-12. LEAD WON / CLIENT CREATED / PROJECT CREATED — one call.
    #        The lead's own history has to record the win, the project
    #        has to point back at the lead it came from, and converting
    #        the same lead twice has to be refused rather than producing
    #        a second client for one business.
    # ---------------------------------------------------------------
    client = authed_client.post(
        "/api/v1/clients",
        json={
            "from_lead_id": lead_id, "package": "core", "won_price_cents": 89900,
            "project_name": "Riverside Plumbing Website",
        },
    ).json()
    assert client["project_count"] == 1
    assert authed_client.get(f"/api/v1/leads/{lead_id}").json()["status"] == "won"

    duplicate = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id, "package": "core"})
    assert duplicate.status_code == 409
    assert "already been converted" in duplicate.json()["detail"]

    project = next(p for p in authed_client.get("/api/v1/projects").json() if p["client_id"] == client["id"])
    project_id = project["id"]
    assert project["stage"] == "intake"
    assert project["source_lead_id"] == lead_id  # traceability back to the sales side
    assert project["package"] == "core" and project["price_cents"] == 89900
    intake_tasks = _project_task_titles(authed_client, project_id)
    assert set(DEFAULT_INTAKE_TASK_TITLES) <= intake_tasks

    # ---------------------------------------------------------------
    # 13. CLIENT INTAKE — re-opening intake must not create a second
    #     project, and must not quietly rewrite a brief that's already
    #     been signed off.
    # ---------------------------------------------------------------
    authed_client.patch(f"/api/v1/projects/{project_id}/brief", json=_REAL_BRIEF)
    approved_brief = authed_client.post(f"/api/v1/projects/{project_id}/brief/approve").json()
    assert approved_brief["status"] == "approved"
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "brief"

    reopened = authed_client.post(
        f"/api/v1/clients/{client['id']}/intake",
        json={"business_name": "Riverside Plumbing", "contact_phone": "03 5555 0000"},
    ).json()
    assert reopened["project_id"] == project_id  # idempotent — no duplicate project
    assert len(authed_client.get("/api/v1/projects").json()) == 1
    # The approved brief is the source of truth every later stage reads
    # from — re-opening intake must not write into it behind the sign-off.
    assert reopened["status"] == "approved"
    assert reopened["business"]["fields"]["contact_phone"] is None

    # ---------------------------------------------------------------
    # INVARIANT 3 — nothing deploys without every prior approval, and
    #     each missing checkpoint is named specifically rather than
    #     lumped into "some approval missing". Checked once per
    #     checkpoint as the chain is completed below.
    # ---------------------------------------------------------------
    assert _deploy_refusal(authed_client, project_id) == [
        "Creative direction", "Sitemap", "Generated website", "QA", "Client review"
    ]

    # ---------------------------------------------------------------
    # 14. CREATIVE DIRECTION — LLM-backed, so a failure must be a clean
    #     503 with nothing stored, not a half-written brief.
    # ---------------------------------------------------------------
    monkeypatch.setattr("app.agents.creative_director.generate_structured", _boom)
    cd_failed = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions")
    assert cd_failed.status_code == 503
    assert authed_client.get(f"/api/v1/projects/{project_id}/creative-directions").json() == []

    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )
    cd = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions").json()
    # The intake brief feeds the creative direction, not a re-guess.
    assert "Client intake brief: approved" in cd["sources_note"]
    authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "design"
    assert _deploy_refusal(authed_client, project_id) == [
        "Sitemap", "Generated website", "QA", "Client review"
    ]

    # ---------------------------------------------------------------
    # 15. SITEMAP — same LLM-failure contract.
    # ---------------------------------------------------------------
    monkeypatch.setattr("app.agents.sitemap.generate_structured", _boom)
    sitemap_failed = authed_client.post(f"/api/v1/projects/{project_id}/sitemaps")
    assert sitemap_failed.status_code == 503
    assert authed_client.get(f"/api/v1/projects/{project_id}/sitemaps").json() == []

    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(SITEMAP_LLM_OUTPUT))
    sitemap = authed_client.post(f"/api/v1/projects/{project_id}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    # Sitemap approval targets DESIGN, which the project already reached
    # via creative direction — advance_stage's forward-only guard makes
    # it a no-op rather than a spurious transition.
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "design"
    assert _deploy_refusal(authed_client, project_id) == ["Generated website", "QA", "Client review"]

    # ---------------------------------------------------------------
    # 16. WEBSITE GENERATED — deterministic, no LLM call. Every internal
    #     link must resolve to a slug the sitemap actually defines: a
    #     hardcoded path here fails technical QA critically and blocks
    #     the whole approval chain.
    # ---------------------------------------------------------------
    website = authed_client.post(f"/api/v1/projects/{project_id}/websites").json()
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "development"

    known_slugs = {p["slug"] for p in website["pages"]}
    internal = [
        h for h in _all_hrefs({"n": website["navigation"], "f": website["footer"], "p": website["pages"]})
        if not h.startswith(("http://", "https://", "mailto:", "tel:"))
    ]
    assert internal, "the generated site should have internal links at all"
    for href in internal:
        assert not href.startswith("#"), f"{href} is a fragment no generated page defines"
        assert href.lstrip("/") in known_slugs, f"{href} points at no real page"
    # Content came only from the brief — the testimonial on file, not an
    # invented one, and with attribution left blank rather than made up.
    home = next(p for p in website["pages"] if p["page_type"] == "home")
    testimonials = next(s for s in home["sections"] if s["type"] == "testimonials")
    assert testimonials["config"]["testimonials"] == [
        {"quote": _REAL_BRIEF["testimonials"], "authorName": ""}
    ]
    assert any("attribution left blank" in m for m in website["missing_information"])

    # ---------------------------------------------------------------
    # 17. ANTI-SLOP EVALUATION — advisory, not a gate, but it must be
    #     *visible* on the same payload the operator approves from, or
    #     the human is nominally in control without being informed.
    # ---------------------------------------------------------------
    assert isinstance(website["anti_slop_score"], int)
    assert "anti_slop_passed" in website and "anti_slop_issues" in website
    assert website["anti_slop_passed"] is True
    assert website["anti_slop_issues"] == []

    # ---------------------------------------------------------------
    # INVARIANT 2 — content the operator can't trace to the brief is
    #     caught. The generator itself only copies real fields, so the
    #     realistic fabrication route is a hand edit; Anti-Slop re-runs
    #     against the testimonials the brief actually had at generation
    #     time, so an invented quote can't pass as sourced.
    # ---------------------------------------------------------------
    fabricated = authed_client.patch(
        f"/api/v1/websites/{website['id']}/sections/{testimonials['id']}",
        json={"config": {"testimonials": [{"quote": "The best plumbers in Australia — saved us thousands!", "authorName": "Jane D"}]}},
    ).json()
    rules = {i["rule"] for i in fabricated["anti_slop_issues"]}
    assert "unverified_testimonial" in rules
    assert "unverified_claim" in rules  # "the best" has no source in the brief
    assert fabricated["anti_slop_passed"] is False
    assert fabricated["anti_slop_score"] < website["anti_slop_score"]
    # Put the real, sourced testimonial back before continuing.
    website = authed_client.patch(
        f"/api/v1/websites/{website['id']}/sections/{testimonials['id']}",
        json={"config": {"testimonials": [{"quote": _REAL_BRIEF["testimonials"], "authorName": ""}]}},
    ).json()
    assert website["anti_slop_passed"] is True

    authed_client.post(f"/api/v1/websites/{website['id']}/approve")
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "qa"
    assert _deploy_refusal(authed_client, project_id) == ["QA", "Client review"]

    # ---------------------------------------------------------------
    # 18. TECHNICAL QA — deterministic checks. The live-preview subset
    #     is reported as skipped (no hosting exists yet), never hidden.
    # ---------------------------------------------------------------
    qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
    assert qa["passed"] is True
    assert qa["skipped_count"] > 0
    assert not [c for c in qa["checks"] if c["status"] == "fail" and c["severity"] == "critical"]
    # A QA report that hasn't been signed off doesn't count as approved.
    assert _deploy_refusal(authed_client, project_id) == ["QA", "Client review"]

    authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "client_review"
    assert _deploy_refusal(authed_client, project_id) == ["Client review"]

    # ---------------------------------------------------------------
    # 19. HUMAN APPROVAL — editing content after sign-off has to revert
    #     every sign-off that was made against the old content, or edited
    #     copy ships under a review that never saw it.
    # ---------------------------------------------------------------
    hero = next(s for s in home["sections"] if s["type"] == "hero")
    edited = authed_client.patch(
        f"/api/v1/websites/{website['id']}/sections/{hero['id']}",
        json={"config": {"subheading": "Same-day callouts across Geelong."}},
    ).json()
    assert edited["approved"] is False and edited["client_approved"] is False
    assert authed_client.get(f"/api/v1/qa-reports/{qa['id']}").json()["human_approved"] is False
    assert set(_deploy_refusal(authed_client, project_id)) == {"Generated website", "QA", "Client review"}

    # Re-approve against the edited content, in the proper order.
    authed_client.post(f"/api/v1/websites/{website['id']}/approve")
    qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
    authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")
    authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "ready_to_deploy"

    approvals = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
    assert approvals["can_deploy"] is True
    assert approvals["missing_for_deployment"] == []
    # Every prerequisite checkpoint records who signed it off and when.
    for checkpoint in approvals["checkpoints"][:6]:
        assert checkpoint["approved"] is True, checkpoint["stage"]
        assert checkpoint["approved_by_user_name"] and checkpoint["approved_at"]

    # ---------------------------------------------------------------
    # 20. WEBSITE PREPARED FOR DEPLOYMENT — the row is the approval
    #     record; nothing is published yet.
    # ---------------------------------------------------------------
    deployment = authed_client.post(f"/api/v1/projects/{project_id}/deployments").json()
    assert deployment["status"] == "pending"
    assert deployment["url"] is None
    assert deployment["approved_by_user_name"] is not None

    # ---------------------------------------------------------------
    # 21. DEPLOYMENT PERFORMED — the mock provider must never claim a
    #     real publish, and a completed deployment can't be re-run.
    # ---------------------------------------------------------------
    executed = authed_client.post(f"/api/v1/deployments/{deployment['id']}/execute").json()
    assert executed["status"] == "success"
    assert executed["target"] == "mock"
    assert executed["url"].endswith(".mock-deploy.internal")
    assert "not a live site" in executed["result"]["note"]
    assert executed["completed_at"] is not None

    repeat = authed_client.post(f"/api/v1/deployments/{deployment['id']}/execute")
    assert repeat.status_code == 400 and "already" in repeat.json()["detail"]

    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "deployed"
    launch_tasks = _project_task_titles(authed_client, project_id)
    assert set(DEFAULT_LAUNCH_TASK_TITLES) <= launch_tasks
    # Seeded exactly once, off the real stage transition — a repeat
    # execute or a rollback must not produce a second copy.
    all_tasks = [t for t in authed_client.get("/api/v1/tasks").json() if t["project_id"] == project_id]
    assert len([t for t in all_tasks if t["title"] == DEFAULT_LAUNCH_TASK_TITLES[0]]) == 1

    # ---------------------------------------------------------------
    # 22. MAINTENANCE — manual only. Nothing auto-advances a project
    #     past DEPLOYED: "the site is being maintained" and "the project
    #     is finished" are operator judgements, and there is no uptime/
    #     link monitoring in this system yet (docs/04_ROADMAP.md M6).
    # ---------------------------------------------------------------
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "deployed"
    authed_client.patch(f"/api/v1/projects/{project_id}", json={"stage": "maintenance"})
    assert authed_client.get(f"/api/v1/projects/{project_id}").json()["stage"] == "maintenance"

    # ---------------------------------------------------------------
    # INVARIANT 4 — an auditable history of every important action.
    # ---------------------------------------------------------------
    lead_actions = {a["action"] for a in _lead_activity(authed_client, lead_id)}
    assert {
        "created",              # 1. lead discovered
        "lead_score_computed",  # 4. lead scored
        "sales_audit_generated",  # 5. sales audit
        "outreach_drafted",     # 6. outreach prepared
        "outreach_approved",
        "outreach_sent",
        "follow_up_generated",  # 7. follow-up scheduled
        "outreach_replied",
        "follow_up_completed",
        "status_changed",
    } <= lead_actions
    # Every status transition, checked by name rather than just "a
    # status_changed exists" — conversion in particular used to record a
    # pipeline_event but no activity row, so winning the deal (the single
    # most important event in a lead's life) was invisible on the lead's
    # own history and only showed up under the new client/project.
    status_summaries = " | ".join(
        a["summary"] for a in _lead_activity(authed_client, lead_id) if a["action"] == "status_changed"
    )
    for transition in (
        "new -> researched",     # 2. lead researched
        "researched -> contacted",  # 6. outreach sent
        "contacted -> replied",  # 7. reply received
        "replied -> meeting",    # 8. meeting booked
        "meeting -> won",        # 10. lead won
    ):
        assert transition in status_summaries, f"no activity-log entry for {transition}"

    project_activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "project", "entity_id": project_id}
    ).json()
    project_actions = {a["action"] for a in project_activity}
    assert {
        "created",                    # 12. project created
        "brief_updated",              # 13. intake
        "brief_approved",
        "creative_direction_generated",  # 14
        "creative_direction_approved",
        "sitemap_generated",          # 15
        "sitemap_approved",
        "website_generated",          # 16
        "website_section_updated",    # 17 (edit reverts approvals)
        "website_approved",           # 19
        "qa_report_approved",         # 18
        "website_client_approved",
        "deployment_prepared",        # 20
        "deployment_succeeded",       # 21
        "stage_changed",              # 13-22
    } <= project_actions

    meeting_actions = {
        a["action"]
        for a in authed_client.get(
            "/api/v1/activity", params={"entity_type": "meeting", "entity_id": meeting["id"]}
        ).json()
    }
    assert {"scheduled", "brief_generated"} <= meeting_actions  # 8, 9

    client_actions = {
        a["action"]
        for a in authed_client.get(
            "/api/v1/activity", params={"entity_type": "client", "entity_id": client["id"]}
        ).json()
    }
    assert "created" in client_actions  # 11

    # pipeline_events (stage-transition history, distinct from
    # activity_log) recorded the same journey — this table has no CRUD
    # routes of its own, so it's checked directly.
    project_events = (
        db_session.query(PipelineEvent)
        .filter(PipelineEvent.project_id == project_id)
        .order_by(PipelineEvent.created_at)
        .all()
    )
    # Sitemap approval and deployment preparation each land on a stage
    # the project is already at (DESIGN, READY_TO_DEPLOY) — advance_stage's
    # "forward only" guard makes both a no-op, so neither shows up here.
    assert [e.summary for e in project_events] == [
        "intake -> brief",
        "brief -> design",
        "design -> development",
        "development -> qa",
        "qa -> client_review",
        "client_review -> ready_to_deploy",
        "ready_to_deploy -> deployed",
        "deployed -> maintenance",
    ]

    lead_events = (
        db_session.query(PipelineEvent)
        .filter(PipelineEvent.lead_id == lead_id)
        .order_by(PipelineEvent.created_at)
        .all()
    )
    assert [e.summary for e in lead_events] == [
        "new -> researched",
        "researched -> contacted",
        "contacted -> replied",
        "replied -> meeting",
        "meeting -> won (converted to client)",
    ]


# ---------------------------------------------------------------------
# Helpers — kept below the test they serve, since they exist only to
# keep the 22-stage walk above readable.
# ---------------------------------------------------------------------


def _lead_activity(authed_client, lead_id):
    return authed_client.get("/api/v1/activity", params={"entity_type": "lead", "entity_id": lead_id}).json()


def _pending_follow_up_ids(authed_client) -> set[str]:
    buckets = authed_client.get("/api/v1/follow-ups").json()
    return {f["id"] for bucket in buckets.values() for f in bucket}


def _project_task_titles(authed_client, project_id) -> set[str]:
    return {t["title"] for t in authed_client.get("/api/v1/tasks").json() if t["project_id"] == project_id}


def _deploy_refusal(authed_client, project_id) -> list[str]:
    """Attempts a deployment and returns the checkpoints it was refused
    for, by name. A 201 here would mean an unapproved publish."""
    res = authed_client.post(f"/api/v1/projects/{project_id}/deployments")
    assert res.status_code == 400, f"deployment was allowed with approvals missing: {res.status_code}"
    detail = res.json()["detail"]
    assert detail.startswith("Cannot deploy — the following approvals are still missing: ")
    return detail.split(": ", 1)[1].rstrip(".").split(", ")
