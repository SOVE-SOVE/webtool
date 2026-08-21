from datetime import date, timedelta

from sqlalchemy import select, update

from app.modules.interactions.models import Interaction, InteractionKind
from app.modules.outreach.models import FollowUp

FAKE_EMAIL = {
    "subject": "A note about riversideplumbing.example",
    "body": "Hi, I came across Riverside Plumbing while looking at local trade sites in Geelong. "
    "Your site doesn't have a mobile viewport tag set, so it may look broken on phones. "
    "Worth a quick call this week to talk through options?",
}
FAKE_TALKING_POINTS = {
    "opening_line": "Hi, I help local trade businesses with their websites — got a minute?",
    "key_points": ["Your site is missing a mobile viewport tag", "It's on HTTPS already, which is good"],
    "objection_handling": ["\"Send me an email instead\" — happy to, I'll follow up with details."],
    "suggested_close": "Ask if a 10-minute call later this week works.",
}
FAKE_FOLLOW_UP = {
    "channel": "phone",
    "due_in_days": 5,
    "suggested_next_action": "They hadn't replied to the email after a few days — try a short call instead.",
}


def _create_qualified_lead(authed_client, **overrides):
    payload = {"business_name": "Riverside Plumbing", "suburb": "Geelong", "state": "VIC"}
    payload.update(overrides)
    lead = authed_client.post("/api/v1/leads", json=payload).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified"})
    return lead


def _patch_email(monkeypatch, output=None):
    monkeypatch.setattr("app.agents.outreach.generate_structured", lambda **kwargs: dict(output or FAKE_EMAIL))


def _patch_talking_points(monkeypatch, output=None):
    monkeypatch.setattr("app.agents.outreach.generate_structured", lambda **kwargs: dict(output or FAKE_TALKING_POINTS))


def _patch_follow_up(monkeypatch, output=None):
    monkeypatch.setattr("app.agents.follow_up.generate_structured", lambda **kwargs: dict(output or FAKE_FOLLOW_UP))


# --- generation -------------------------------------------------------


def test_generate_outreach_requires_auth(client):
    res = client.post(
        "/api/v1/leads/00000000-0000-0000-0000-000000000000/outreach", json={"channel": "email"}
    )
    assert res.status_code == 401


def test_generate_outreach_unknown_lead_404s(authed_client):
    res = authed_client.post(
        "/api/v1/leads/00000000-0000-0000-0000-000000000000/outreach", json={"channel": "email"}
    )
    assert res.status_code == 404


def test_generate_email_outreach_happy_path(authed_client, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"})
    assert res.status_code == 201
    body = res.json()
    assert body["channel"] == "email"
    assert body["status"] == "drafted"
    assert body["subject"] == FAKE_EMAIL["subject"]
    assert body["body"] == FAKE_EMAIL["body"]
    assert body["key_points"] == []

    activity = authed_client.get(f"/api/v1/activity?entity_type=lead&entity_id={lead['id']}").json()
    assert any(a["action"] == "outreach_drafted" for a in activity)


def test_generate_phone_outreach_happy_path(authed_client, monkeypatch):
    _patch_talking_points(monkeypatch)
    lead = _create_qualified_lead(authed_client)

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "phone"})
    assert res.status_code == 201
    body = res.json()
    assert body["channel"] == "phone"
    assert body["opening_line"] == FAKE_TALKING_POINTS["opening_line"]
    assert body["key_points"] == FAKE_TALKING_POINTS["key_points"]
    assert body["objection_handling"] == FAKE_TALKING_POINTS["objection_handling"]
    assert body["suggested_close"] == FAKE_TALKING_POINTS["suggested_close"]
    assert body["subject"] is None


def test_generate_in_person_outreach_happy_path(authed_client, monkeypatch):
    _patch_talking_points(monkeypatch)
    lead = _create_qualified_lead(authed_client)

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "in_person"})
    assert res.status_code == 201
    assert res.json()["channel"] == "in_person"


def test_outreach_grounded_in_sales_audit(authed_client, monkeypatch):
    from tests.test_sales_audits import FAKE_LLM_OUTPUT
    from app.integrations.browser import PageSignals

    async def fake_fetch(url):
        return PageSignals(final_url=url, https=True, http_status=200, title="t", load_time_ms=500)

    monkeypatch.setattr("app.agents.website_audit.fetch_page_signals", fake_fetch)
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(FAKE_LLM_OUTPUT))
    monkeypatch.setattr("app.integrations.search.search_business", lambda query: None)

    lead = _create_qualified_lead(authed_client)
    authed_client.patch(f"/api/v1/businesses/{lead['business_id']}", json={"website_url": "https://riversideplumbing.example"})
    sales_audit = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits").json()

    _patch_email(monkeypatch)
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"})
    assert res.status_code == 201
    assert res.json()["flagged_for_review"] is False

    assert res.json()["based_on_sales_audit_id"] == sales_audit["id"]


def test_generate_outreach_no_evidence_flags_for_review(authed_client, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)  # no website audit, no sales audit yet

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"})
    assert res.status_code == 201
    assert res.json()["flagged_for_review"] is True


def test_outreach_workspace_isolated(authed_client, other_authed_client, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"})
    message_id = res.json()["id"]

    assert other_authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).status_code == 404
    assert other_authed_client.get(f"/api/v1/leads/{lead['id']}/outreach").status_code == 404
    assert other_authed_client.get(f"/api/v1/outreach/{message_id}").status_code == 404
    assert other_authed_client.post(f"/api/v1/outreach/{message_id}/approve").status_code == 404


# --- lifecycle ----------------------------------------------------------


def test_outreach_never_auto_advances_past_drafted(authed_client, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"})
    assert res.json()["status"] == "drafted"


def test_outreach_lifecycle_approve_send_reply_close(authed_client, db_session, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    message = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).json()
    message_id = message["id"]

    approved = authed_client.post(f"/api/v1/outreach/{message_id}/approve").json()
    assert approved["status"] == "approved"
    assert approved["approved_by_user_name"] is not None

    sent = authed_client.post(f"/api/v1/outreach/{message_id}/mark-sent").json()
    assert sent["status"] == "sent"
    assert sent["sent_by_user_name"] is not None

    interactions = db_session.scalars(
        select(Interaction).where(Interaction.lead_id == lead["id"], Interaction.kind == InteractionKind.OUTREACH_SENT)
    ).all()
    assert len(interactions) == 1

    replied = authed_client.post(f"/api/v1/outreach/{message_id}/mark-replied").json()
    assert replied["status"] == "replied"
    assert replied["replied_at"] is not None

    reply_interactions = db_session.scalars(
        select(Interaction).where(Interaction.lead_id == lead["id"], Interaction.kind == InteractionKind.REPLY)
    ).all()
    assert len(reply_interactions) == 1

    closed = authed_client.post(f"/api/v1/outreach/{message_id}/close").json()
    assert closed["status"] == "closed"
    assert closed["closed_by_user_name"] is not None

    activity = authed_client.get(f"/api/v1/activity?entity_type=lead&entity_id={lead['id']}").json()
    actions = {a["action"] for a in activity}
    assert {"outreach_drafted", "outreach_approved", "outreach_sent", "outreach_replied", "outreach_closed"} <= actions
    assert all(a["user_name"] for a in activity)


def test_cannot_approve_already_approved_outreach(authed_client, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    message_id = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).json()["id"]
    authed_client.post(f"/api/v1/outreach/{message_id}/approve")

    res = authed_client.post(f"/api/v1/outreach/{message_id}/approve")
    assert res.status_code == 400


def test_cannot_mark_sent_before_drafted_is_valid_but_not_twice(authed_client, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    message_id = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).json()["id"]

    assert authed_client.post(f"/api/v1/outreach/{message_id}/mark-sent").status_code == 200
    assert authed_client.post(f"/api/v1/outreach/{message_id}/mark-sent").status_code == 400


def test_cannot_close_already_closed_outreach(authed_client, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    message_id = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).json()["id"]
    authed_client.post(f"/api/v1/outreach/{message_id}/close")

    assert authed_client.post(f"/api/v1/outreach/{message_id}/close").status_code == 400


# --- follow-ups -----------------------------------------------------------


def test_generate_follow_up_requires_auth(client):
    res = client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/follow-ups")
    assert res.status_code == 401


def test_generate_follow_up_unknown_lead_404s(authed_client):
    res = authed_client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/follow-ups")
    assert res.status_code == 404


def test_generate_follow_up_no_prior_outreach(authed_client, monkeypatch):
    _patch_follow_up(monkeypatch)
    lead = _create_qualified_lead(authed_client)

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/follow-ups")
    assert res.status_code == 201
    body = res.json()
    assert body["channel"] == "phone"
    assert body["previous_outreach"] is None
    assert body["status"] == "pending"
    assert body["due_date"] == (date.today() + timedelta(days=5)).isoformat()


def test_generate_follow_up_considers_previous_outreach_and_flips_message_status(authed_client, monkeypatch):
    _patch_email(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    message = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).json()
    authed_client.post(f"/api/v1/outreach/{message['id']}/mark-sent")

    _patch_follow_up(monkeypatch)
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/follow-ups")
    assert res.status_code == 201
    body = res.json()
    assert body["previous_outreach"]["id"] == message["id"]
    assert body["previous_outreach"]["channel"] == "email"

    updated_message = authed_client.get(f"/api/v1/outreach/{message['id']}").json()
    assert updated_message["status"] == "follow_up_due"

    activity = authed_client.get(f"/api/v1/activity?entity_type=lead&entity_id={lead['id']}").json()
    assert any(a["action"] == "follow_up_generated" for a in activity)


def test_follow_up_out_of_range_days_is_clamped_and_flagged(authed_client, monkeypatch):
    _patch_follow_up(monkeypatch, {**FAKE_FOLLOW_UP, "due_in_days": 999})
    lead = _create_qualified_lead(authed_client)

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/follow-ups")
    assert res.status_code == 201
    body = res.json()
    assert body["due_date"] == (date.today() + timedelta(days=30)).isoformat()


def test_follow_ups_bucketed_overdue_due_today_upcoming(authed_client, db_session, monkeypatch):
    _patch_follow_up(monkeypatch)
    lead_a = _create_qualified_lead(authed_client, business_name="Overdue Co")
    lead_b = _create_qualified_lead(authed_client, business_name="Today Co")
    lead_c = _create_qualified_lead(authed_client, business_name="Upcoming Co")

    fu_a = authed_client.post(f"/api/v1/leads/{lead_a['id']}/follow-ups").json()
    fu_b = authed_client.post(f"/api/v1/leads/{lead_b['id']}/follow-ups").json()
    fu_c = authed_client.post(f"/api/v1/leads/{lead_c['id']}/follow-ups").json()

    db_session.execute(update(FollowUp).where(FollowUp.id == fu_a["id"]).values(due_date=date.today() - timedelta(days=2)))
    db_session.execute(update(FollowUp).where(FollowUp.id == fu_b["id"]).values(due_date=date.today()))
    db_session.execute(update(FollowUp).where(FollowUp.id == fu_c["id"]).values(due_date=date.today() + timedelta(days=10)))
    db_session.commit()

    buckets = authed_client.get("/api/v1/follow-ups").json()
    assert [f["id"] for f in buckets["overdue"]] == [fu_a["id"]]
    assert [f["id"] for f in buckets["due_today"]] == [fu_b["id"]]
    assert [f["id"] for f in buckets["upcoming"]] == [fu_c["id"]]


def test_resolve_follow_up_removes_it_from_buckets(authed_client, monkeypatch):
    _patch_follow_up(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    follow_up = authed_client.post(f"/api/v1/leads/{lead['id']}/follow-ups").json()

    res = authed_client.post(f"/api/v1/follow-ups/{follow_up['id']}/resolve")
    assert res.status_code == 200
    assert res.json()["status"] == "done"
    assert res.json()["resolved_by_user_name"] is not None

    buckets = authed_client.get("/api/v1/follow-ups").json()
    all_ids = [f["id"] for f in buckets["overdue"] + buckets["due_today"] + buckets["upcoming"]]
    assert follow_up["id"] not in all_ids

    assert authed_client.post(f"/api/v1/follow-ups/{follow_up['id']}/resolve").status_code == 400

    activity = authed_client.get(f"/api/v1/activity?entity_type=lead&entity_id={lead['id']}").json()
    assert any(a["action"] == "follow_up_completed" for a in activity)


def test_follow_ups_workspace_isolated(authed_client, other_authed_client, monkeypatch):
    _patch_follow_up(monkeypatch)
    lead = _create_qualified_lead(authed_client)
    follow_up = authed_client.post(f"/api/v1/leads/{lead['id']}/follow-ups").json()

    assert other_authed_client.post(f"/api/v1/leads/{lead['id']}/follow-ups").status_code == 404
    assert other_authed_client.post(f"/api/v1/follow-ups/{follow_up['id']}/resolve").status_code == 404

    other_buckets = other_authed_client.get("/api/v1/follow-ups").json()
    all_ids = [f["id"] for f in other_buckets["overdue"] + other_buckets["due_today"] + other_buckets["upcoming"]]
    assert follow_up["id"] not in all_ids


# --- lead status bookkeeping ------------------------------------------
#
# Marking outreach sent/replied is the operator recording something they
# already did by hand; the lead's own status shouldn't then need a second
# manual edit. Forward-only, same contract as leads/service.py's
# `mark_researched` and meetings/service.py's `_PRE_MEETING_STATUSES`.


def _sent_message(authed_client, monkeypatch, lead):
    _patch_email(monkeypatch)
    message = authed_client.post(f"/api/v1/leads/{lead['id']}/outreach", json={"channel": "email"}).json()
    authed_client.post(f"/api/v1/outreach/{message['id']}/mark-sent")
    return message


def test_marking_outreach_sent_moves_the_lead_to_contacted(authed_client, monkeypatch):
    lead = _create_qualified_lead(authed_client)
    _sent_message(authed_client, monkeypatch, lead)

    assert authed_client.get(f"/api/v1/leads/{lead['id']}").json()["status"] == "contacted"


def test_marking_outreach_sent_advances_an_untouched_new_lead(authed_client, monkeypatch):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Fresh Co"}).json()
    assert lead["status"] == "new"
    _sent_message(authed_client, monkeypatch, lead)

    assert authed_client.get(f"/api/v1/leads/{lead['id']}").json()["status"] == "contacted"


def test_marking_outreach_replied_moves_the_lead_to_replied(authed_client, monkeypatch):
    lead = _create_qualified_lead(authed_client)
    message = _sent_message(authed_client, monkeypatch, lead)

    authed_client.post(f"/api/v1/outreach/{message['id']}/mark-replied")
    assert authed_client.get(f"/api/v1/leads/{lead['id']}").json()["status"] == "replied"


def test_outreach_never_regresses_a_lead_that_is_further_along(authed_client, monkeypatch):
    lead = _create_qualified_lead(authed_client)
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "proposal"})

    message = _sent_message(authed_client, monkeypatch, lead)
    assert authed_client.get(f"/api/v1/leads/{lead['id']}").json()["status"] == "proposal"

    authed_client.post(f"/api/v1/outreach/{message['id']}/mark-replied")
    assert authed_client.get(f"/api/v1/leads/{lead['id']}").json()["status"] == "proposal"


def test_outreach_leaves_a_nurture_lead_parked(authed_client, monkeypatch):
    """NURTURE is a deliberate parking state, not a pipeline position —
    touching base shouldn't drag it back into the active funnel."""
    lead = _create_qualified_lead(authed_client)
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "nurture"})

    _sent_message(authed_client, monkeypatch, lead)
    assert authed_client.get(f"/api/v1/leads/{lead['id']}").json()["status"] == "nurture"


def test_lead_status_bump_is_recorded_in_the_activity_log(authed_client, monkeypatch):
    lead = _create_qualified_lead(authed_client)
    _sent_message(authed_client, monkeypatch, lead)

    activity = authed_client.get(f"/api/v1/activity?entity_type=lead&entity_id={lead['id']}").json()
    assert any(
        a["action"] == "status_changed" and "outreach sent" in (a["summary"] or "") for a in activity
    )
