"""
Integration coverage for the full pipeline end to end: LEAD -> RESEARCH
-> OUTREACH -> MEETING -> WON -> CLIENT/PROJECT -> INTAKE -> CREATIVE
DIRECTION -> SITEMAP -> DEVELOPMENT -> QA -> CLIENT REVIEW -> APPROVAL
-> DEPLOYMENT. Every other test file exercises one module in isolation
(fixtures start from `_create_project_without_lead`, bypassing the
sales side entirely); this file is the one place a real `Lead` row is
walked all the way through to a deployed website, checking that
information actually flows forward (lead status, project stage,
activity log, pipeline_events) rather than each module just working in
isolation.
"""

from app.integrations.browser import PageSignals
from app.integrations.search import SearchResult
from app.modules.pipeline.models import PipelineEvent

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

_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "contact_email": "hello@riversideplumbing.com.au",
}


def _patch_research(monkeypatch):
    async def fake_fetch(url):
        return PageSignals(
            final_url=url, https=True, http_status=200, title="Riverside Plumbing",
            meta_description="Local plumbing services", viewport_meta_present=False,
            mobile_overflow=True, load_time_ms=850,
        )

    monkeypatch.setattr("app.agents.website_audit.fetch_page_signals", fake_fetch)
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(SALES_AUDIT_LLM_OUTPUT))
    monkeypatch.setattr(
        "app.integrations.search.search_business",
        lambda query: [SearchResult(title="Riverside Plumbing", url="https://example.com", description="Plumber")],
    )


def _patch_outreach(monkeypatch):
    monkeypatch.setattr("app.agents.outreach.generate_structured", lambda **kwargs: dict(FAKE_EMAIL_OUTPUT))


def _patch_creative_director(monkeypatch):
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )


def _patch_sitemap_agent(monkeypatch):
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(SITEMAP_LLM_OUTPUT))


def test_full_pipeline_lead_to_deployment(authed_client, db_session, monkeypatch):
    _patch_research(monkeypatch)
    _patch_outreach(monkeypatch)
    _patch_creative_director(monkeypatch)
    _patch_sitemap_agent(monkeypatch)

    # LEAD
    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Riverside Plumbing", "suburb": "Geelong", "state": "VIC"}
    ).json()
    lead_id = lead["id"]
    assert lead["status"] == "new"
    authed_client.patch(
        f"/api/v1/businesses/{lead['business_id']}", json={"website_url": "https://riversideplumbing.example"}
    )

    # RESEARCH — generating a sales audit runs the website audit first and
    # feeds it into both the lead score and the audit itself.
    audit = authed_client.post(f"/api/v1/leads/{lead_id}/sales-audits").json()
    assert audit["website_audit"]["has_existing_site"] is True
    assert audit["suggested_offer"] == SALES_AUDIT_LLM_OUTPUT["suggested_offer"]
    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead["status"] == "researched"
    assert lead["score"] is not None

    # OUTREACH — drafted from the sales audit, approved, sent.
    outreach = authed_client.post(f"/api/v1/leads/{lead_id}/outreach", json={"channel": "email"}).json()
    assert outreach["subject"] == FAKE_EMAIL_OUTPUT["subject"]
    authed_client.post(f"/api/v1/outreach/{outreach['id']}/approve")
    authed_client.post(f"/api/v1/outreach/{outreach['id']}/mark-sent")
    # Marking outreach sent is the "we've made contact" event — the
    # operator already did the sending, so the status follows on its own
    # rather than needing a second manual edit (docs/05_DECISIONS.md,
    # 2026-08-21).
    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead["status"] == "contacted"

    # MEETING — booking one bumps the lead to MEETING and generates a brief.
    meeting = authed_client.post(
        "/api/v1/meetings",
        json={"title": "Discovery call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead_id},
    ).json()
    assert meeting["meeting_type"] == "sales_call"
    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead["status"] == "meeting"

    # WON -> CLIENT/PROJECT — converting creates the Client and a Project
    # at INTAKE in one transaction, and marks the lead WON.
    client = authed_client.post(
        "/api/v1/clients",
        json={"from_lead_id": lead_id, "package": "core", "won_price_cents": 89900, "project_name": "Riverside Plumbing Website"},
    ).json()
    assert client["project_count"] == 1
    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead["status"] == "won"

    projects = authed_client.get("/api/v1/projects").json()
    project = next(p for p in projects if p["client_id"] == client["id"])
    project_id = project["id"]
    assert project["stage"] == "intake"
    assert project["source_lead_id"] == lead_id

    # CLIENT INTAKE / BRIEF
    authed_client.patch(f"/api/v1/projects/{project_id}/brief", json=_REAL_BRIEF)
    authed_client.post(f"/api/v1/projects/{project_id}/brief/approve")
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "brief"

    # CREATIVE DIRECTION
    cd = authed_client.post(f"/api/v1/projects/{project_id}/creative-directions").json()
    authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "design"

    # SITEMAP
    sitemap = authed_client.post(f"/api/v1/projects/{project_id}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "design"

    # WEBSITE (DEVELOPMENT) -> internal approval (QA stage begins)
    website = authed_client.post(f"/api/v1/projects/{project_id}/websites").json()
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "development"

    authed_client.post(f"/api/v1/websites/{website['id']}/approve")
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "qa"

    # QA -> approving it opens client review
    qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
    authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "client_review"

    # CLIENT REVIEW -> ready to deploy
    authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "ready_to_deploy"

    approvals = authed_client.get(f"/api/v1/projects/{project_id}/approvals").json()
    assert approvals["can_deploy"] is True

    # APPROVAL -> DEPLOYMENT (prepare + execute)
    deployment = authed_client.post(f"/api/v1/projects/{project_id}/deployments").json()
    assert deployment["status"] == "pending"
    deployment = authed_client.post(f"/api/v1/deployments/{deployment['id']}/execute").json()
    assert deployment["status"] == "success"
    assert deployment["url"] is not None

    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "deployed"

    # Important events show up in the activity/history system, for both
    # halves of the pipeline.
    lead_activity = authed_client.get("/api/v1/activity", params={"entity_type": "lead", "entity_id": lead_id}).json()
    lead_actions = {a["action"] for a in lead_activity}
    assert {"created", "lead_score_computed", "sales_audit_generated", "status_changed"} <= lead_actions

    project_activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "project", "entity_id": project_id}
    ).json()
    project_actions = {a["action"] for a in project_activity}
    assert {
        "created", "brief_approved", "creative_direction_approved", "sitemap_approved",
        "website_generated", "website_approved", "qa_report_approved", "website_client_approved",
        "deployment_prepared", "deployment_succeeded", "stage_changed",
    } <= project_actions

    # pipeline_events (stage-transition history, distinct from
    # activity_log) recorded the same journey — this table has no CRUD
    # routes of its own, so it's checked directly.
    project_events = (
        db_session.query(PipelineEvent).filter(PipelineEvent.project_id == project_id).order_by(PipelineEvent.created_at).all()
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
    ]

    lead_events = db_session.query(PipelineEvent).filter(PipelineEvent.lead_id == lead_id).order_by(PipelineEvent.created_at).all()
    lead_event_summaries = [e.summary for e in lead_events]
    assert "new -> researched" in lead_event_summaries
    assert "researched -> contacted" in lead_event_summaries
    assert "contacted -> meeting" in lead_event_summaries
    assert "meeting -> won (converted to client)" in lead_event_summaries
