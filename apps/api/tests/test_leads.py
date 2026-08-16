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
    assert body["status"] == "new"
    assert body["priority"] == "medium"
    assert body["score"] is None

    list_res = authed_client.get("/api/v1/leads")
    assert len(list_res.json()) == 1


def test_update_lead_status_and_score(authed_client):
    create_res = authed_client.post("/api/v1/leads", json={"business_name": "Northside Electrical"})
    lead_id = create_res.json()["id"]

    patch_res = authed_client.patch(f"/api/v1/leads/{lead_id}", json={"status": "qualified", "score": 82})
    assert patch_res.status_code == 200
    body = patch_res.json()
    assert body["status"] == "qualified"
    assert body["score"] == 82


def test_update_lead_priority_and_notes(authed_client):
    create_res = authed_client.post("/api/v1/leads", json={"business_name": "Northside Electrical"})
    lead_id = create_res.json()["id"]

    patch_res = authed_client.patch(
        f"/api/v1/leads/{lead_id}", json={"priority": "high", "notes": "Called, follow up Friday"}
    )
    assert patch_res.status_code == 200
    body = patch_res.json()
    assert body["priority"] == "high"
    assert body["notes"] == "Called, follow up Friday"


def test_create_lead_with_priority(authed_client):
    res = authed_client.post(
        "/api/v1/leads", json={"business_name": "Northside Electrical", "priority": "high"}
    )
    assert res.status_code == 201
    assert res.json()["priority"] == "high"


def test_archive_and_unarchive_lead(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Northside Electrical"}).json()

    archive_res = authed_client.post(f"/api/v1/leads/{lead['id']}/archive")
    assert archive_res.status_code == 200
    assert archive_res.json()["archived_at"] is not None

    default_list = authed_client.get("/api/v1/leads").json()
    assert lead["id"] not in [item["id"] for item in default_list]

    with_archived = authed_client.get("/api/v1/leads?include_archived=true").json()
    assert lead["id"] in [item["id"] for item in with_archived]

    unarchive_res = authed_client.post(f"/api/v1/leads/{lead['id']}/unarchive")
    assert unarchive_res.status_code == 200
    assert unarchive_res.json()["archived_at"] is None

    default_list_after = authed_client.get("/api/v1/leads").json()
    assert lead["id"] in [item["id"] for item in default_list_after]


def test_archive_unknown_lead_404s(authed_client):
    res = authed_client.post("/api/v1/leads/00000000-0000-0000-0000-000000000000/archive")
    assert res.status_code == 404


def test_get_lead_not_found(authed_client):
    res = authed_client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


def test_update_lead_not_found(authed_client):
    res = authed_client.patch(
        "/api/v1/leads/00000000-0000-0000-0000-000000000000", json={"status": "won"}
    )
    assert res.status_code == 404
