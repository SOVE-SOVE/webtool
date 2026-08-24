def _lead(authed_client, name="Riverside Plumbing"):
    return authed_client.post("/api/v1/leads", json={"business_name": name}).json()


def test_create_opportunity_requires_auth(client):
    res = client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/opportunities", json={})
    assert res.status_code == 401


def test_create_opportunity_404_for_unknown_lead(authed_client):
    res = authed_client.post(
        "/api/v1/leads/00000000-0000-0000-0000-000000000000/opportunities",
        json={"tier": "main", "proposed_price_cents": 89900},
    )
    assert res.status_code == 404


def test_create_opportunity_logs_a_real_proposal(authed_client):
    lead = _lead(authed_client)

    res = authed_client.post(
        f"/api/v1/leads/{lead['id']}/opportunities", json={"tier": "main", "proposed_price_cents": 89900}
    )
    assert res.status_code == 201
    body = res.json()
    assert body["lead_id"] == lead["id"]
    assert body["business_name"] == "Riverside Plumbing"
    assert body["tier"] == "main"
    assert body["proposed_price_cents"] == 89900
    assert body["status"] == "open"
    assert body["closed_at"] is None


def test_create_opportunity_advances_lead_to_proposal(authed_client):
    lead = _lead(authed_client)
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "replied"})

    authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={"proposed_price_cents": 50000})

    updated = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert updated["status"] == "proposal"


def test_create_opportunity_never_regresses_a_lead_further_along(authed_client):
    lead = _lead(authed_client)
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "won"})

    authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={"proposed_price_cents": 50000})

    updated = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert updated["status"] == "won"


def test_create_opportunity_with_no_price_logged_is_still_created(authed_client):
    lead = _lead(authed_client)

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={})
    assert res.status_code == 201
    assert res.json()["proposed_price_cents"] is None


def test_list_opportunities_for_lead(authed_client):
    lead = _lead(authed_client)
    authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={"proposed_price_cents": 10000})
    authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={"proposed_price_cents": 20000})

    res = authed_client.get(f"/api/v1/leads/{lead['id']}/opportunities")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 2
    # newest first
    assert body[0]["proposed_price_cents"] == 20000


def test_list_opportunities_404_for_unknown_lead(authed_client):
    res = authed_client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000/opportunities")
    assert res.status_code == 404


def test_mark_opportunity_lost(authed_client):
    lead = _lead(authed_client)
    opportunity = authed_client.post(
        f"/api/v1/leads/{lead['id']}/opportunities", json={"proposed_price_cents": 50000}
    ).json()

    res = authed_client.post(f"/api/v1/opportunities/{opportunity['id']}/mark-lost")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "lost"
    assert body["closed_at"] is not None

    updated_lead = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert updated_lead["status"] == "lost"


def test_mark_opportunity_lost_twice_400s(authed_client):
    lead = _lead(authed_client)
    opportunity = authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={}).json()
    authed_client.post(f"/api/v1/opportunities/{opportunity['id']}/mark-lost")

    res = authed_client.post(f"/api/v1/opportunities/{opportunity['id']}/mark-lost")
    assert res.status_code == 400


def test_mark_opportunity_lost_does_not_reopen_a_won_lead(authed_client, db_session):
    from app.modules.leads.models import Lead, LeadStatus

    lead = _lead(authed_client)
    opportunity = authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={}).json()

    # The deal closed WON through some other path in the meantime (e.g.
    # client conversion) — a stale/superseded quote being marked lost
    # afterwards must not reopen the question.
    db_row = db_session.get(Lead, lead["id"])
    db_row.status = LeadStatus.WON
    db_session.commit()

    authed_client.post(f"/api/v1/opportunities/{opportunity['id']}/mark-lost")

    updated_lead = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert updated_lead["status"] == "won"


def test_cannot_access_opportunity_from_another_workspace(authed_client, other_authed_client):
    lead = _lead(authed_client)
    opportunity = authed_client.post(f"/api/v1/leads/{lead['id']}/opportunities", json={}).json()

    res = other_authed_client.post(f"/api/v1/opportunities/{opportunity['id']}/mark-lost")
    assert res.status_code == 404

    res = other_authed_client.get(f"/api/v1/leads/{lead['id']}/opportunities")
    assert res.status_code == 404
