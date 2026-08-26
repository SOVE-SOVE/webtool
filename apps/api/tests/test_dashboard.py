from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.modules.interactions.models import Interaction, InteractionKind
from app.modules.leads.models import Lead
from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity


def test_overview_requires_auth(client):
    res = client.get("/api/v1/dashboard/overview")
    assert res.status_code == 401


def test_overview_empty_state(authed_client):
    res = authed_client.get("/api/v1/dashboard/overview")
    assert res.status_code == 200
    body = res.json()
    assert body["total_leads"] == 0
    assert body["qualified_leads"] == 0
    assert body["contacted_leads"] == 0
    assert body["upcoming_meetings"] == 0
    assert body["follow_ups_due"] == 0
    assert body["won_projects"] == 0
    assert body["active_projects"] == 0
    assert body["revenue_cents"] == 0
    assert body["tasks_needing_attention"] == 0
    assert body["needs_attention"] == []


def test_overview_counts_leads_and_qualification(authed_client):
    lead_a = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    authed_client.post("/api/v1/leads", json={"business_name": "B"})
    authed_client.patch(f"/api/v1/leads/{lead_a['id']}", json={"status": "qualified", "score": 70})

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert body["total_leads"] == 2
    assert body["qualified_leads"] == 1


def test_overview_excludes_archived_leads(authed_client):
    lead_a = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    authed_client.patch(f"/api/v1/leads/{lead_a['id']}", json={"status": "qualified"})
    authed_client.post("/api/v1/leads", json={"business_name": "B"})
    authed_client.post(f"/api/v1/leads/{lead_a['id']}/archive")

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert body["total_leads"] == 1
    assert body["qualified_leads"] == 0


def test_overview_counts_contacted_leads(authed_client, db_session):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()

    db_session.add(Interaction(lead_id=lead["id"], kind=InteractionKind.OUTREACH_SENT, summary="Sent email"))
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert body["contacted_leads"] == 1


def test_overview_counts_meetings_and_revenue(authed_client, db_session):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    authed_client.post(
        "/api/v1/meetings",
        json={"title": "Discovery call", "scheduled_at": "2026-09-01T10:00:00Z", "lead_id": lead["id"]},
    )

    opportunity = SalesOpportunity(
        lead_id=lead["id"], status=OpportunityStatus.WON, proposed_price_cents=89900
    )
    db_session.add(opportunity)
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert body["upcoming_meetings"] == 1
    assert body["won_projects"] == 1
    assert body["revenue_cents"] == 89900


def test_overview_counts_project_meetings_too(authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "A"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Site"}
    ).json()
    authed_client.post(
        "/api/v1/meetings",
        json={
            "title": "Kickoff check-in",
            "scheduled_at": "2026-09-01T10:00:00Z",
            "project_id": project["id"],
        },
    )

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert body["upcoming_meetings"] == 1


def test_overview_active_projects_excludes_maintenance_and_complete(authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "A"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Site"}
    ).json()

    assert authed_client.get("/api/v1/dashboard/overview").json()["active_projects"] == 1

    authed_client.patch(f"/api/v1/projects/{project['id']}", json={"stage": "maintenance"})
    assert authed_client.get("/api/v1/dashboard/overview").json()["active_projects"] == 0

    authed_client.patch(f"/api/v1/projects/{project['id']}", json={"stage": "complete"})
    assert authed_client.get("/api/v1/dashboard/overview").json()["active_projects"] == 0


def test_overview_needs_attention_overdue_task(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    authed_client.post(
        "/api/v1/tasks", json={"title": "Call back", "lead_id": lead["id"], "due_at": yesterday}
    )

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert body["tasks_needing_attention"] == 1
    assert any(item["kind"] == "task" and item["title"] == "Call back" for item in body["needs_attention"])


def test_overview_needs_attention_stale_lead(authed_client, db_session):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Stale Co"}).json()
    stale_time = datetime.now(timezone.utc) - timedelta(days=6)
    db_session.execute(update(Lead).where(Lead.id == lead["id"]).values(updated_at=stale_time))
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert any(
        item["kind"] == "stale_lead" and item["title"] == "Stale Co" for item in body["needs_attention"]
    )


# --- "What should I do next" list -------------------------------------
#
# The Overview is the screen an operator opens first, so these cover the
# whole signal set it now aggregates, not just tasks and stale leads:
# overdue follow-ups, imminent meetings, the per-project delivery gate
# that's actually blocking, and a broken deployment. See
# docs/05_DECISIONS.md (2026-08-21).

CREATIVE_DIRECTION_LLM_OUTPUT = {
    "facts": ["Riverside Plumbing is a residential plumbing business."],
    "assumptions": [],
    "creative_concept": "A dependable, no-nonsense local tradie brand.",
    "visual_direction": "Clean, high-contrast, utilitarian.",
    "brand_personality": ["Trustworthy", "Prompt"],
    "colour_direction": "Deep blue with an amber accent.",
    "typography_direction": "A confident, legible sans-serif.",
    "spacing_system": "Generous section padding with clear breathing room around the call-to-action.",
    "image_direction": "Real photos of the crew and completed jobs.",
    "component_style": "Solid, squared-off buttons with a slight shadow.",
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

_REAL_BRIEF = {
    "business_description": "Licensed local plumbers serving Ipswich since 2011.",
    "contact_email": "hello@riversideplumbing.com.au",
}


def _project(authed_client, business_name="Riverside Plumbing"):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": business_name}).json()
    return authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": f"{business_name} website"}
    ).json()


def _attention(authed_client):
    return authed_client.get("/api/v1/dashboard/overview").json()["needs_attention"]


def _of_kind(items, kind):
    return [i for i in items if i["kind"] == kind]


def _project_items(authed_client, project_id):
    return [i for i in _of_kind(_attention(authed_client), "project") if i["id"] == project_id]


def test_upcoming_meetings_ignores_past_and_closed_meetings(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "A"}).json()
    past = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    soon = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    authed_client.post("/api/v1/meetings", json={"title": "Old call", "scheduled_at": past, "lead_id": lead["id"]})
    upcoming = authed_client.post(
        "/api/v1/meetings", json={"title": "Next call", "scheduled_at": soon, "lead_id": lead["id"]}
    ).json()

    assert authed_client.get("/api/v1/dashboard/overview").json()["upcoming_meetings"] == 1

    authed_client.patch(f"/api/v1/meetings/{upcoming['id']}", json={"status": "cancelled"})
    assert authed_client.get("/api/v1/dashboard/overview").json()["upcoming_meetings"] == 0


def test_imminent_meeting_shows_up_but_a_distant_one_does_not(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Coastal Cafe"}).json()
    far = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
    authed_client.post("/api/v1/meetings", json={"title": "Later", "scheduled_at": far, "lead_id": lead["id"]})
    assert _of_kind(_attention(authed_client), "meeting") == []

    soon = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
    authed_client.post("/api/v1/meetings", json={"title": "Sales call", "scheduled_at": soon, "lead_id": lead["id"]})

    items = _of_kind(_attention(authed_client), "meeting")
    assert len(items) == 1
    assert items[0]["title"] == "Coastal Cafe"
    assert "Sales call" in items[0]["detail"]


def test_overdue_follow_up_surfaces_with_its_suggested_action(authed_client, db_session):
    from datetime import date as _date

    from app.modules.outreach.models import FollowUp, OutreachChannel

    lead = authed_client.post("/api/v1/leads", json={"business_name": "Bakery Co"}).json()
    db_session.add(
        FollowUp(
            lead_id=lead["id"],
            channel=OutreachChannel.EMAIL,
            due_date=_date.today() - timedelta(days=3),
            suggested_next_action="Call the owner about the quote",
            model_used="test",
            prompt_version="test",
        )
    )
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert body["follow_ups_due"] == 1
    items = _of_kind(body["needs_attention"], "follow_up")
    assert len(items) == 1
    assert items[0]["title"] == "Bakery Co"
    assert items[0]["detail"] == "3 days overdue"
    assert items[0]["action"] == "Call the owner about the quote"
    assert items[0]["href"] == f"/dashboard/leads/{lead['id']}"


def test_future_follow_up_is_not_yet_due(authed_client, db_session):
    from datetime import date as _date

    from app.modules.outreach.models import FollowUp, OutreachChannel

    lead = authed_client.post("/api/v1/leads", json={"business_name": "Bakery Co"}).json()
    db_session.add(
        FollowUp(
            lead_id=lead["id"],
            channel=OutreachChannel.EMAIL,
            due_date=_date.today() + timedelta(days=4),
            suggested_next_action="Check back next week",
            model_used="test",
            prompt_version="test",
        )
    )
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/overview").json()
    assert body["follow_ups_due"] == 0
    assert _of_kind(body["needs_attention"], "follow_up") == []


def test_project_reports_only_its_first_unmet_gate(authed_client, monkeypatch):
    monkeypatch.setattr(
        "app.agents.creative_director.generate_structured", lambda **kwargs: dict(CREATIVE_DIRECTION_LLM_OUTPUT)
    )
    monkeypatch.setattr("app.agents.sitemap.generate_structured", lambda **kwargs: dict(SITEMAP_LLM_OUTPUT))
    project = _project(authed_client)
    pid = project["id"]

    def only_item():
        items = _project_items(authed_client, pid)
        assert len(items) == 1, items  # never more than one row per project
        return items[0]

    assert only_item()["label"] == "Brief"

    authed_client.patch(f"/api/v1/projects/{pid}/brief", json=_REAL_BRIEF)
    authed_client.post(f"/api/v1/projects/{pid}/brief/approve")
    item = only_item()
    assert item["label"] == "Creative"
    assert item["action"] == "Generate the creative direction"

    cd = authed_client.post(f"/api/v1/projects/{pid}/creative-directions").json()
    assert only_item()["action"] == "Review and approve the creative direction"
    authed_client.post(f"/api/v1/creative-directions/{cd['id']}/approve")
    assert only_item()["label"] == "Sitemap"

    sitemap = authed_client.post(f"/api/v1/projects/{pid}/sitemaps").json()
    authed_client.post(f"/api/v1/sitemaps/{sitemap['id']}/approve")
    item = only_item()
    assert item["label"] == "Build"
    assert item["href"] == f"/dashboard/projects/{pid}/website"

    website = authed_client.post(f"/api/v1/projects/{pid}/websites").json()
    assert only_item()["action"] == "Review the generated site and approve it"
    authed_client.post(f"/api/v1/websites/{website['id']}/approve")
    assert only_item()["label"] == "QA"

    qa = authed_client.post(f"/api/v1/websites/{website['id']}/qa-reports").json()
    authed_client.post(f"/api/v1/qa-reports/{qa['id']}/approve")
    item = only_item()
    assert item["label"] == "Client"
    assert item["action"] == "Send the preview to the client and record their approval"

    authed_client.post(f"/api/v1/websites/{website['id']}/client-approve")
    item = only_item()
    assert item["label"] == "Deploy"
    assert item["action"] == "Deploy the site"

    authed_client.post(f"/api/v1/projects/{pid}/deployments")
    # Fully approved and deployed — nothing left for the operator to do.
    assert _project_items(authed_client, pid) == []


def test_failed_deployment_outranks_everything_else(authed_client, db_session):
    from app.modules.deployments.models import Deployment
    from app.modules.websites.models import Website

    project = _project(authed_client)
    pid = project["id"]

    # An overdue task exists too, so the ordering is actually exercised.
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    authed_client.post("/api/v1/tasks", json={"title": "Old task", "project_id": pid, "due_at": yesterday})

    # The failed deployment is built directly: the API refuses to create
    # one without every approval in place, and this test is about the
    # dashboard's reaction to a failure, not about how it got there.
    site = Website(project_id=pid, config={"pages": []})
    db_session.add(site)
    db_session.flush()
    db_session.add(Deployment(website_id=site.id, environment="production", status="failed", error_message="boom"))
    db_session.commit()

    items = _attention(authed_client)
    assert items[0]["kind"] == "project"
    assert items[0]["label"] == "Deploy"
    assert "failed" in items[0]["detail"]
    assert items[0]["action"] == "Check the error and re-run the deployment"
    assert [i["kind"] for i in items].index("task") > 0


def test_finished_projects_drop_off_the_list(authed_client):
    project = _project(authed_client)
    assert _project_items(authed_client, project["id"])

    authed_client.patch(f"/api/v1/projects/{project['id']}", json={"stage": "complete"})
    assert _project_items(authed_client, project["id"]) == []


def test_stale_lead_action_depends_on_how_far_it_got(authed_client, db_session):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Stale Co"}).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified"})
    stale_time = datetime.now(timezone.utc) - timedelta(days=6)
    db_session.execute(update(Lead).where(Lead.id == lead["id"]).values(updated_at=stale_time))
    db_session.commit()

    item = _of_kind(_attention(authed_client), "stale_lead")[0]
    assert item["action"] == "Draft and send outreach"
    assert item["href"] == f"/dashboard/leads/{lead['id']}"
