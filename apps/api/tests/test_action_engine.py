"""
Phase 7 part 2, task 1 — the daily "Do This Next" queue
(modules/action_engine). Covers: each of the seven example kinds gets
picked up, the ranking actually reflects urgency/deadline/opportunity/
pipeline value (a failed deployment outranks a merely-overdue
follow-up), and /queue is idempotent within a day while /run always
recomputes.
"""

from datetime import date, datetime, timedelta, timezone

import pytest


def _kinds(body):
    return [item["kind"] for item in body["items"]]


def _of_kind(body, kind):
    return [item for item in body["items"] if item["kind"] == kind]


def test_queue_requires_auth(client):
    res = client.get("/api/v1/actions/queue")
    assert res.status_code == 401


def test_queue_empty_state(authed_client):
    body = authed_client.get("/api/v1/actions/queue").json()
    assert body["items"] == []


def test_hot_lead_uncontacted_surfaces_after_grace_period(authed_client, db_session):
    from app.modules.leads.models import Lead

    lead = authed_client.post(
        "/api/v1/leads", json={"business_name": "Riverside Plumbing", "priority": "high"}
    ).json()
    from sqlalchemy import update

    db_session.execute(
        update(Lead).where(Lead.id == lead["id"]).values(created_at=datetime.now(timezone.utc) - timedelta(hours=6))
    )
    db_session.commit()

    body = authed_client.post("/api/v1/actions/run").json()
    items = _of_kind(body, "hot_lead_uncontacted")
    assert len(items) == 1
    assert items[0]["title"] == "Riverside Plumbing"
    assert items[0]["href"] == f"/dashboard/leads/{lead['id']}"


def test_brand_new_hot_lead_not_flagged_yet(authed_client):
    authed_client.post("/api/v1/leads", json={"business_name": "Brand New Co", "priority": "high"})

    body = authed_client.post("/api/v1/actions/run").json()
    assert _of_kind(body, "hot_lead_uncontacted") == []


def test_overdue_follow_up_surfaces(authed_client, db_session):
    from app.modules.outreach.models import FollowUp, OutreachChannel

    lead = authed_client.post("/api/v1/leads", json={"business_name": "Bakery Co"}).json()
    db_session.add(
        FollowUp(
            lead_id=lead["id"],
            channel=OutreachChannel.EMAIL,
            due_date=date.today() - timedelta(days=3),
            suggested_next_action="Call the owner about the quote",
            model_used="test",
            prompt_version="test",
        )
    )
    db_session.commit()

    body = authed_client.post("/api/v1/actions/run").json()
    items = _of_kind(body, "follow_up_overdue")
    assert len(items) == 1
    assert items[0]["action_text"] == "Call the owner about the quote"
    assert "3 day" in items[0]["detail"]


def test_meeting_approaching_surfaces_within_window(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Coastal Cafe"}).json()
    soon = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
    authed_client.post("/api/v1/meetings", json={"title": "Sales call", "scheduled_at": soon, "lead_id": lead["id"]})

    far = (datetime.now(timezone.utc) + timedelta(days=10)).isoformat()
    lead2 = authed_client.post("/api/v1/leads", json={"business_name": "Far Away Co"}).json()
    authed_client.post("/api/v1/meetings", json={"title": "Later call", "scheduled_at": far, "lead_id": lead2["id"]})

    body = authed_client.post("/api/v1/actions/run").json()
    items = _of_kind(body, "meeting_approaching")
    assert len(items) == 1
    assert items[0]["title"] == "Coastal Cafe"


def test_deployment_failed_outranks_everything(authed_client, db_session):
    from app.modules.deployments.models import Deployment
    from app.modules.outreach.models import FollowUp, OutreachChannel
    from app.modules.websites.models import Website

    # An overdue follow-up too, so ranking is actually exercised.
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Slow Lead Co"}).json()
    db_session.add(
        FollowUp(
            lead_id=lead["id"],
            channel=OutreachChannel.EMAIL,
            due_date=date.today() - timedelta(days=1),
            suggested_next_action="Chase them",
            model_used="test",
            prompt_version="test",
        )
    )

    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Broken Deploy Co"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Site"}
    ).json()
    # Built directly rather than through the generation pipeline — this
    # test is about the queue's reaction to a failure, not about how the
    # website/deployment got there (same rationale as test_dashboard's
    # equivalent `test_failed_deployment_outranks_everything_else`).
    website = Website(project_id=project["id"], config={"pages": []})
    db_session.add(website)
    db_session.flush()
    db_session.add(Deployment(website_id=website.id, environment="production", status="failed", error_message="boom"))
    db_session.commit()

    body = authed_client.post("/api/v1/actions/run").json()
    assert body["items"][0]["kind"] == "deployment_failed"
    assert body["items"][0]["priority_score"] == max(i["priority_score"] for i in body["items"])
    assert "deployment_failed" in _kinds(body)
    assert "follow_up_overdue" in _kinds(body)


def test_proposal_awaiting_response_uses_pipeline_value(authed_client, db_session):
    from app.modules.leads.models import Lead, LeadStatus
    from app.modules.sales_opportunities.models import OpportunityStatus, SalesOpportunity
    from sqlalchemy import update

    lead = authed_client.post("/api/v1/leads", json={"business_name": "Big Deal Co"}).json()
    db_session.execute(
        update(Lead)
        .where(Lead.id == lead["id"])
        .values(status=LeadStatus.PROPOSAL, updated_at=datetime.now(timezone.utc) - timedelta(days=5))
    )
    db_session.add(SalesOpportunity(lead_id=lead["id"], status=OpportunityStatus.OPEN, proposed_price_cents=500000))
    db_session.commit()

    body = authed_client.post("/api/v1/actions/run").json()
    items = _of_kind(body, "proposal_awaiting_response")
    assert len(items) == 1
    assert items[0]["pipeline_value_cents"] == 500000


def test_client_assets_missing_uses_brief_assets_section(authed_client, db_session):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Needs Assets Co"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Site"}
    ).json()
    # DesignBrief is created lazily on first touch — opening the brief
    # page is what a real operator does before filling anything in.
    authed_client.get(f"/api/v1/projects/{project['id']}/brief")
    body = authed_client.post("/api/v1/actions/run").json()
    items = _of_kind(body, "client_assets_missing")
    assert len(items) == 1
    assert items[0]["title"] == "Needs Assets Co"


def test_website_revision_awaiting_approval(authed_client, db_session):
    from app.modules.websites.models import Website

    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Awaiting Approval Co"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Site"}
    ).json()
    db_session.add(Website(project_id=project["id"], config={"pages": []}, approved=False))
    db_session.commit()

    body = authed_client.post("/api/v1/actions/run").json()
    items = _of_kind(body, "website_revision_awaiting_approval")
    assert len(items) == 1
    assert items[0]["title"] == "Awaiting Approval Co"


def test_queue_is_idempotent_within_a_day(authed_client):
    authed_client.post("/api/v1/leads", json={"business_name": "A Co", "priority": "high"})
    first = authed_client.get("/api/v1/actions/queue").json()
    second = authed_client.get("/api/v1/actions/queue").json()
    assert first["run_id"] == second["run_id"]


def test_run_always_recomputes(authed_client):
    first = authed_client.post("/api/v1/actions/run").json()
    second = authed_client.post("/api/v1/actions/run").json()
    assert first["run_id"] != second["run_id"]


def test_history_lists_past_runs(authed_client):
    authed_client.post("/api/v1/actions/run")
    authed_client.post("/api/v1/actions/run")
    history = authed_client.get("/api/v1/actions/history").json()
    assert len(history) == 2
