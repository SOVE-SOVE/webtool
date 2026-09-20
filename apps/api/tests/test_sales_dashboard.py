import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import update

from app.modules.interactions.models import Interaction, InteractionKind
from app.modules.leads.models import Lead
from app.modules.outreach.models import FollowUp, OutreachChannel
from app.modules.sales_opportunities.models import SalesOpportunity
from app.modules.workspaces.models import Workspace


def _lead(authed_client, name="Riverside Plumbing"):
    return authed_client.post("/api/v1/leads", json={"business_name": name}).json()


def test_sales_dashboard_requires_auth(client):
    res = client.get("/api/v1/dashboard/sales")
    assert res.status_code == 401


def test_sales_dashboard_empty_state(authed_client):
    res = authed_client.get("/api/v1/dashboard/sales")
    assert res.status_code == 200
    body = res.json()
    assert body["new_leads_count"] == 0
    assert body["hot_leads_count"] == 0
    assert body["needs_follow_up_count"] == 0
    assert body["upcoming_meetings_count"] == 0
    assert body["proposals_count"] == 0
    assert body["won_deals_count"] == 0
    assert body["lost_deals_count"] == 0
    assert body["conversion_rate_pct"] is None
    assert body["estimated_revenue_cents"] == 0
    assert body["actual_revenue_cents"] == 0
    assert body["do_this_next"] == []
    assert body["outreach_activity"]["sent_last_7_days"] == 0
    assert body["outreach_activity"]["reply_rate_pct"] is None


def test_new_leads_counted_and_listed(authed_client):
    _lead(authed_client, "Fresh Co")
    lead_b = _lead(authed_client, "Researched Co")
    authed_client.patch(f"/api/v1/leads/{lead_b['id']}", json={"status": "researched"})

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["new_leads_count"] == 1
    assert body["new_leads"][0]["business_name"] == "Fresh Co"


def test_hot_leads_by_priority_or_score(authed_client):
    high_priority = _lead(authed_client, "Urgent Co")
    authed_client.patch(f"/api/v1/leads/{high_priority['id']}", json={"priority": "high", "status": "qualified"})

    high_score = _lead(authed_client, "Broken Site Co")
    authed_client.patch(f"/api/v1/leads/{high_score['id']}", json={"score": 85, "status": "qualified"})

    cold = _lead(authed_client, "Cold Co")
    authed_client.patch(f"/api/v1/leads/{cold['id']}", json={"score": 20, "status": "qualified"})

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["hot_leads_count"] == 2
    names = {item["business_name"] for item in body["hot_leads"]}
    assert names == {"Urgent Co", "Broken Site Co"}
    # highest score first
    assert body["hot_leads"][0]["business_name"] == "Broken Site Co"


def test_hot_leads_excludes_won_lost_nurture(authed_client):
    lead = _lead(authed_client, "Done Co")
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"priority": "high", "status": "won"})

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["hot_leads_count"] == 0


def test_needs_follow_up(authed_client, db_session):
    lead = _lead(authed_client, "Bakery Co")
    db_session.add(
        FollowUp(
            lead_id=lead["id"],
            channel=OutreachChannel.EMAIL,
            due_date=date.today() - timedelta(days=2),
            suggested_next_action="Call the owner",
            model_used="test",
            prompt_version="test",
        )
    )
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["needs_follow_up_count"] == 1
    item = body["needs_follow_up"][0]
    assert item["business_name"] == "Bakery Co"
    assert item["overdue"] is True
    assert item["suggested_next_action"] == "Call the owner"

    follow_up_items = [i for i in body["do_this_next"] if i["kind"] == "follow_up"]
    assert len(follow_up_items) == 1
    assert follow_up_items[0]["title"] == "Bakery Co"


def test_upcoming_meetings_scoped_to_lead_side_only(authed_client):
    lead = _lead(authed_client, "Coastal Cafe")
    soon = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    authed_client.post("/api/v1/meetings", json={"title": "Sales call", "scheduled_at": soon, "lead_id": lead["id"]})

    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Existing Client"}).json()
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_row["id"], "name": "Site"}
    ).json()
    authed_client.post(
        "/api/v1/meetings", json={"title": "Check-in", "scheduled_at": soon, "project_id": project["id"]}
    )

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["upcoming_meetings_count"] == 1
    assert body["upcoming_meetings"][0]["business_name"] == "Coastal Cafe"


def test_imminent_meeting_shows_up_in_do_this_next(authed_client):
    lead = _lead(authed_client, "Coastal Cafe")
    soon = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
    authed_client.post("/api/v1/meetings", json={"title": "Sales call", "scheduled_at": soon, "lead_id": lead["id"]})

    body = authed_client.get("/api/v1/dashboard/sales").json()
    meeting_items = [i for i in body["do_this_next"] if i["kind"] == "meeting"]
    assert len(meeting_items) == 1
    assert meeting_items[0]["title"] == "Coastal Cafe"


def test_proposals_lists_leads_at_proposal_status(authed_client):
    lead = _lead(authed_client, "Quoted Co")
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "meeting"})
    authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={"proposed_price_cents": 75000})

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["proposals_count"] == 1
    proposal = body["proposals"][0]
    assert proposal["business_name"] == "Quoted Co"
    assert proposal["proposed_price_cents"] == 75000


def test_proposal_with_no_logged_price_shows_null_not_zero(authed_client):
    lead = _lead(authed_client, "Handshake Co")
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "proposal"})

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["proposals_count"] == 1
    assert body["proposals"][0]["proposed_price_cents"] is None


def test_won_and_lost_deals_and_conversion_rate(authed_client):
    won_lead = _lead(authed_client, "Won Co")
    authed_client.post(
        "/api/v1/clients", json={"from_lead_id": won_lead["id"], "won_price_cents": 120000}
    )

    lost_lead = _lead(authed_client, "Lost Co")
    opp = authed_client.post(f"/api/v1/leads/{lost_lead['id']}/opportunities", json={"proposed_price_cents": 50000}).json()
    authed_client.post(f"/api/v1/opportunities/{opp['id']}/mark-lost")

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["won_deals_count"] == 1
    assert body["lost_deals_count"] == 1
    assert body["conversion_rate_pct"] == 50.0
    assert body["actual_revenue_cents"] == 120000
    assert body["recent_won"][0]["business_name"] == "Won Co"
    assert body["recent_won"][0]["closed_at"] is not None
    assert body["recent_lost"][0]["business_name"] == "Lost Co"
    assert body["recent_lost"][0]["proposed_price_cents"] == 50000


def test_estimated_revenue_only_counts_open_opportunities(authed_client):
    lead = _lead(authed_client, "Open Deal Co")
    authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={"proposed_price_cents": 30000})

    won_lead = _lead(authed_client, "Won Co")
    authed_client.post("/api/v1/clients", json={"from_lead_id": won_lead["id"], "won_price_cents": 90000})

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["estimated_revenue_cents"] == 30000
    assert body["actual_revenue_cents"] == 90000


def test_outreach_activity_counts_and_reply_rate(authed_client, db_session):
    lead = _lead(authed_client, "Active Co")
    db_session.add(Interaction(lead_id=lead["id"], kind=InteractionKind.OUTREACH_SENT, summary="Sent"))
    db_session.add(Interaction(lead_id=lead["id"], kind=InteractionKind.REPLY, summary="They replied"))
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["outreach_activity"]["sent_last_7_days"] == 1
    assert body["outreach_activity"]["replied_last_7_days"] == 1
    assert body["outreach_activity"]["reply_rate_pct"] == 100.0
    assert len(body["outreach_activity"]["recent"]) == 2


def test_outreach_activity_ignores_old_interactions(authed_client, db_session):
    lead = _lead(authed_client, "Old Co")
    old = Interaction(lead_id=lead["id"], kind=InteractionKind.OUTREACH_SENT, summary="Sent ages ago")
    db_session.add(old)
    db_session.commit()
    db_session.execute(
        update(Interaction).where(Interaction.id == old.id).values(occurred_at=datetime.now(timezone.utc) - timedelta(days=30))
    )
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["outreach_activity"]["sent_last_7_days"] == 0


def test_hot_uncontacted_lead_surfaces_in_do_this_next(authed_client):
    lead = _lead(authed_client, "Hot Idle Co")
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified", "priority": "high"})

    body = authed_client.get("/api/v1/dashboard/sales").json()
    hot_items = [i for i in body["do_this_next"] if i["kind"] == "hot_lead"]
    assert len(hot_items) == 1
    assert hot_items[0]["title"] == "Hot Idle Co"
    assert hot_items[0]["action"] == "Draft and send outreach"


def test_hot_lead_with_outreach_already_sent_does_not_surface(authed_client, db_session):
    lead = _lead(authed_client, "Hot Contacted Co")
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified", "priority": "high"})
    db_session.add(Interaction(lead_id=lead["id"], kind=InteractionKind.OUTREACH_SENT, summary="Sent"))
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/sales").json()
    hot_items = [i for i in body["do_this_next"] if i["kind"] == "hot_lead"]
    assert hot_items == []


def test_stale_proposal_surfaces_in_do_this_next(authed_client, db_session):
    lead = _lead(authed_client, "Stale Quote Co")
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "meeting"})
    authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={"proposed_price_cents": 60000})

    stale_time = datetime.now(timezone.utc) - timedelta(days=6)
    db_session.execute(update(Lead).where(Lead.id == lead["id"]).values(updated_at=stale_time))
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/sales").json()
    stale_items = [i for i in body["do_this_next"] if i["kind"] == "stale_proposal"]
    assert len(stale_items) == 1
    assert stale_items[0]["title"] == "Stale Quote Co"


def test_stale_new_lead_surfaces_in_do_this_next(authed_client, db_session):
    lead = _lead(authed_client, "Neglected Co")
    stale_time = datetime.now(timezone.utc) - timedelta(days=3)
    db_session.execute(update(Lead).where(Lead.id == lead["id"]).values(created_at=stale_time))
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/sales").json()
    stale_items = [i for i in body["do_this_next"] if i["kind"] == "new_lead"]
    assert len(stale_items) == 1
    assert stale_items[0]["title"] == "Neglected Co"


def test_do_this_next_ranks_overdue_follow_up_before_stale_new_lead(authed_client, db_session):
    stale_new = _lead(authed_client, "Neglected Co")
    db_session.execute(
        update(Lead).where(Lead.id == stale_new["id"]).values(created_at=datetime.now(timezone.utc) - timedelta(days=3))
    )

    overdue_lead = _lead(authed_client, "Overdue Follow-up Co")
    db_session.add(
        FollowUp(
            lead_id=overdue_lead["id"],
            channel=OutreachChannel.EMAIL,
            due_date=date.today() - timedelta(days=1),
            suggested_next_action="Call back",
            model_used="test",
            prompt_version="test",
        )
    )
    db_session.commit()

    body = authed_client.get("/api/v1/dashboard/sales").json()
    kinds = [i["kind"] for i in body["do_this_next"]]
    assert kinds.index("follow_up") < kinds.index("new_lead")


def test_sales_dashboard_is_workspace_scoped(authed_client, other_authed_client):
    _lead(authed_client, "Mine Co")
    _lead(other_authed_client, "Theirs Co")

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["new_leads_count"] == 1
    assert body["new_leads"][0]["business_name"] == "Mine Co"


# --- GET /dashboard/sales/won-deals ------------------------------------------

WON_DEALS_URL = "/api/v1/dashboard/sales/won-deals"


def _set_timezone(db_session, workspace, tz_name):
    db_session.execute(update(Workspace).where(Workspace.id == workspace.id).values(timezone=tz_name))
    db_session.commit()


def _won_deal(authed_client, db_session, name, closed_at, price_cents=None):
    """Converts a lead (which records a WON opportunity), then pins its
    closed_at so the test controls exactly which day the deal lands on."""
    lead = _lead(authed_client, name)
    body = {"from_lead_id": lead["id"]}
    if price_cents is not None:
        body["won_price_cents"] = price_cents
    assert authed_client.post("/api/v1/clients", json=body).status_code == 201
    db_session.execute(
        update(SalesOpportunity).where(SalesOpportunity.lead_id == uuid.UUID(lead["id"])).values(closed_at=closed_at)
    )
    db_session.commit()
    return lead


def _utc(year, month, day, hour=12):
    return datetime(year, month, day, hour, tzinfo=timezone.utc)


def test_won_deals_requires_auth(client):
    res = client.get(WON_DEALS_URL, params={"start": "2026-03-01", "end": "2026-03-07"})
    assert res.status_code == 401


def test_won_deals_empty_range_is_zero_filled(authed_client):
    res = authed_client.get(WON_DEALS_URL, params={"start": "2026-03-01", "end": "2026-03-07"})
    assert res.status_code == 200
    body = res.json()
    assert body["group_by"] == "day"
    assert [p["period_start"] for p in body["points"]] == [f"2026-03-0{d}" for d in range(1, 8)]
    assert all(p["deals_count"] == 0 and p["revenue_cents"] == 0 for p in body["points"])
    assert body["total_deals_count"] == 0
    assert body["total_revenue_cents"] == 0
    assert body["prior_deals_count"] == 0
    assert body["prior_revenue_cents"] == 0
    assert body["undated_deals_count"] == 0


def test_won_deals_bucketed_by_day_with_prior_undated_and_unpriced(authed_client, db_session, workspace):
    _set_timezone(db_session, workspace, "UTC")
    _won_deal(authed_client, db_session, "A Co", _utc(2026, 3, 2, 9), 100000)
    _won_deal(authed_client, db_session, "B Co (no price)", _utc(2026, 3, 2, 15))
    _won_deal(authed_client, db_session, "C Co", _utc(2026, 3, 4), 50000)
    _won_deal(authed_client, db_session, "Prior Co", _utc(2026, 2, 20), 70000)
    _won_deal(authed_client, db_session, "After Co", _utc(2026, 3, 9), 10000)
    _won_deal(authed_client, db_session, "Undated Co", None, 30000)

    body = authed_client.get(WON_DEALS_URL, params={"start": "2026-03-01", "end": "2026-03-07"}).json()
    by_day = {p["period_start"]: p for p in body["points"]}

    assert by_day["2026-03-02"] == {
        "period_start": "2026-03-02",
        "deals_count": 2,
        "revenue_cents": 100000,
        "unpriced_deals_count": 1,
    }
    assert by_day["2026-03-04"]["deals_count"] == 1
    assert by_day["2026-03-04"]["revenue_cents"] == 50000
    assert by_day["2026-03-03"]["deals_count"] == 0

    # The unpriced deal is counted, and adds nothing to revenue.
    assert body["total_deals_count"] == 3
    assert body["total_revenue_cents"] == 150000
    assert body["total_unpriced_deals_count"] == 1
    assert body["prior_deals_count"] == 1
    assert body["prior_revenue_cents"] == 70000
    assert body["undated_deals_count"] == 1
    assert body["undated_revenue_cents"] == 30000

    # Reconciles with the all-time figure: range + prior + undated + the
    # deal closed after the range.
    all_time = authed_client.get("/api/v1/dashboard/sales").json()["actual_revenue_cents"]
    assert all_time == 150000 + 70000 + 30000 + 10000


def test_won_deals_not_limited_to_the_ten_most_recent(authed_client, db_session, workspace):
    _set_timezone(db_session, workspace, "UTC")
    for i in range(12):
        _won_deal(authed_client, db_session, f"Deal {i}", _utc(2026, 3, 1 + i), 1000)

    body = authed_client.get(WON_DEALS_URL, params={"start": "2026-03-01", "end": "2026-03-31"}).json()
    assert body["total_deals_count"] == 12
    assert body["total_revenue_cents"] == 12000


def test_won_deals_grouped_by_week_starting_monday(authed_client, db_session, workspace):
    _set_timezone(db_session, workspace, "UTC")
    _won_deal(authed_client, db_session, "Before start", _utc(2026, 3, 3), 5000)  # Tue, before the range
    _won_deal(authed_client, db_session, "Wed", _utc(2026, 3, 4), 1000)
    _won_deal(authed_client, db_session, "Sun", _utc(2026, 3, 8), 2000)  # last day of that ISO week
    _won_deal(authed_client, db_session, "Mon", _utc(2026, 3, 9), 4000)  # first day of the next
    _won_deal(authed_client, db_session, "Next Wed", _utc(2026, 3, 18), 8000)

    body = authed_client.get(
        WON_DEALS_URL, params={"start": "2026-03-04", "end": "2026-03-18", "group_by": "week"}
    ).json()

    assert body["group_by"] == "week"
    assert [p["period_start"] for p in body["points"]] == ["2026-03-02", "2026-03-09", "2026-03-16"]
    assert [p["deals_count"] for p in body["points"]] == [2, 1, 1]
    assert [p["revenue_cents"] for p in body["points"]] == [3000, 4000, 8000]
    assert body["prior_deals_count"] == 1
    assert body["prior_revenue_cents"] == 5000


def test_won_deals_are_dated_in_the_workspace_timezone(authed_client, db_session, workspace):
    _set_timezone(db_session, workspace, "Australia/Brisbane")  # UTC+10, no DST
    # 15:00 UTC on the 1st is 01:00 on the 2nd in Brisbane.
    _won_deal(authed_client, db_session, "Late evening UTC", _utc(2026, 3, 1, 15), 1000)
    # 13:59 UTC on the 1st is 23:59 on the 1st in Brisbane.
    _won_deal(authed_client, db_session, "Just before midnight", _utc(2026, 3, 1, 13) + timedelta(minutes=59), 2000)
    # 14:30 UTC on 28 Feb is 00:30 on 1 Mar in Brisbane — inside the range, not "prior".
    _won_deal(authed_client, db_session, "Local midnight", datetime(2026, 2, 28, 14, 30, tzinfo=timezone.utc), 4000)

    body = authed_client.get(WON_DEALS_URL, params={"start": "2026-03-01", "end": "2026-03-03"}).json()
    by_day = {p["period_start"]: p for p in body["points"]}
    assert by_day["2026-03-01"]["revenue_cents"] == 6000
    assert by_day["2026-03-02"]["revenue_cents"] == 1000
    assert body["prior_deals_count"] == 0


def test_won_deals_excludes_open_and_lost_opportunities(authed_client, db_session, workspace):
    _set_timezone(db_session, workspace, "UTC")
    open_lead = _lead(authed_client, "Open Co")
    authed_client.post(f"/api/v1/leads/{open_lead['id']}/opportunities", json={"proposed_price_cents": 30000})
    lost_lead = _lead(authed_client, "Lost Co")
    opp = authed_client.post(f"/api/v1/leads/{lost_lead['id']}/opportunities", json={"proposed_price_cents": 50000}).json()
    authed_client.post(f"/api/v1/opportunities/{opp['id']}/mark-lost")
    db_session.execute(update(SalesOpportunity).values(closed_at=_utc(2026, 3, 2)))
    db_session.commit()

    body = authed_client.get(WON_DEALS_URL, params={"start": "2026-03-01", "end": "2026-03-07"}).json()
    assert body["total_deals_count"] == 0
    assert body["prior_deals_count"] == 0
    assert body["undated_deals_count"] == 0


def test_won_deals_single_day_range(authed_client, db_session, workspace):
    _set_timezone(db_session, workspace, "UTC")
    _won_deal(authed_client, db_session, "Same Day Co", _utc(2026, 3, 5), 9000)

    body = authed_client.get(WON_DEALS_URL, params={"start": "2026-03-05", "end": "2026-03-05"}).json()
    assert len(body["points"]) == 1
    assert body["points"][0]["revenue_cents"] == 9000


def test_won_deals_rejects_bad_ranges_and_params(authed_client):
    assert authed_client.get(WON_DEALS_URL, params={"start": "2026-03-07", "end": "2026-03-01"}).status_code == 400
    # Longer than the two-year cap.
    assert authed_client.get(WON_DEALS_URL, params={"start": "2024-01-01", "end": "2026-03-01"}).status_code == 400
    assert authed_client.get(WON_DEALS_URL, params={"start": "2026-03-01"}).status_code == 422
    assert authed_client.get(WON_DEALS_URL, params={"end": "2026-03-01"}).status_code == 422
    bad_group = {"start": "2026-03-01", "end": "2026-03-07", "group_by": "month"}
    assert authed_client.get(WON_DEALS_URL, params=bad_group).status_code == 422


def test_won_deals_is_workspace_scoped(authed_client, other_authed_client, db_session, workspace, other_workspace):
    _set_timezone(db_session, workspace, "UTC")
    _set_timezone(db_session, other_workspace, "UTC")
    _won_deal(authed_client, db_session, "Mine Co", _utc(2026, 3, 2), 1000)
    _won_deal(other_authed_client, db_session, "Theirs Co", _utc(2026, 3, 2), 99000)

    body = authed_client.get(WON_DEALS_URL, params={"start": "2026-03-01", "end": "2026-03-07"}).json()
    assert body["total_deals_count"] == 1
    assert body["total_revenue_cents"] == 1000
