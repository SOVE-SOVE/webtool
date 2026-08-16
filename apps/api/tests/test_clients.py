def test_create_client_directly(authed_client):
    res = authed_client.post(
        "/api/v1/clients",
        json={"business_name": "Coastal Cafe", "billing_email": "billing@coastalcafe.example"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["business_name"] == "Coastal Cafe"
    assert body["billing_email"] == "billing@coastalcafe.example"
    assert body["project_count"] == 0


def test_create_client_requires_exactly_one_source(authed_client):
    res = authed_client.post("/api/v1/clients", json={})
    assert res.status_code == 422

    res = authed_client.post(
        "/api/v1/clients",
        json={"business_name": "A", "from_lead_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 422


def test_convert_lead_to_client_marks_lead_won(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    client_res = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id})
    assert client_res.status_code == 201
    assert client_res.json()["business_name"] == "Hilltop Roofing"

    lead_after = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead_after["stage"] == "won"


def test_convert_lead_records_won_opportunity_for_dashboard(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id, "won_price_cents": 89900})

    overview = authed_client.get("/api/v1/dashboard/overview").json()
    assert overview["won_projects"] == 1
    assert overview["revenue_cents"] == 89900


def test_convert_lead_without_price_still_counts_as_won(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id})

    overview = authed_client.get("/api/v1/dashboard/overview").json()
    assert overview["won_projects"] == 1
    assert overview["revenue_cents"] == 0


def test_convert_unknown_lead_404s(authed_client):
    res = authed_client.post(
        "/api/v1/clients", json={"from_lead_id": "00000000-0000-0000-0000-000000000000"}
    )
    assert res.status_code == 404


def test_get_client_not_found(authed_client):
    res = authed_client.get("/api/v1/clients/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
