def test_list_leads_requires_auth(client):
    res = client.get("/api/v1/leads")
    assert res.status_code == 401


def test_create_lead_creates_business_too(authed_client):
    res = authed_client.post(
        "/api/v1/leads",
        json={"business_name": "Riverside Plumbing", "industry": "plumbing", "suburb": "Geelong", "state": "VIC"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["business_name"] == "Riverside Plumbing"
    assert body["stage"] == "prospect"
    assert body["score"] is None

    list_res = authed_client.get("/api/v1/leads")
    assert len(list_res.json()) == 1


def test_update_lead_stage_and_score(authed_client):
    create_res = authed_client.post("/api/v1/leads", json={"business_name": "Northside Electrical"})
    lead_id = create_res.json()["id"]

    patch_res = authed_client.patch(f"/api/v1/leads/{lead_id}", json={"stage": "lead_score", "score": 82})
    assert patch_res.status_code == 200
    body = patch_res.json()
    assert body["stage"] == "lead_score"
    assert body["score"] == 82


def test_get_lead_not_found(authed_client):
    res = authed_client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


def test_update_lead_not_found(authed_client):
    res = authed_client.patch(
        "/api/v1/leads/00000000-0000-0000-0000-000000000000", json={"stage": "won"}
    )
    assert res.status_code == 404
