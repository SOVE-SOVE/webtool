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
    assert lead_after["status"] == "won"


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


def test_update_client_billing_and_contract_fields(authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()

    res = authed_client.patch(
        f"/api/v1/clients/{client_row['id']}",
        json={"billing_email": "billing@coastalcafe.example", "contract_signed_at": "2026-08-18T00:00:00Z"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["billing_email"] == "billing@coastalcafe.example"
    assert body["contract_signed_at"] is not None


def test_update_client_clears_billing_email(authed_client):
    client_row = authed_client.post(
        "/api/v1/clients", json={"business_name": "Coastal Cafe", "billing_email": "old@example.com"}
    ).json()

    res = authed_client.patch(f"/api/v1/clients/{client_row['id']}", json={"billing_email": None})
    assert res.status_code == 200
    assert res.json()["billing_email"] is None


def test_update_client_omitted_fields_untouched(authed_client):
    client_row = authed_client.post(
        "/api/v1/clients", json={"business_name": "Coastal Cafe", "billing_email": "keep@example.com"}
    ).json()

    res = authed_client.patch(f"/api/v1/clients/{client_row['id']}", json={})
    assert res.status_code == 200
    assert res.json()["billing_email"] == "keep@example.com"
