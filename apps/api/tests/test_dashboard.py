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
    assert body["meetings"] == 0
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
    assert body["meetings"] == 1
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
    assert body["meetings"] == 1


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
