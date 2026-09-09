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


def test_archive_lead_is_idempotent_and_logs_activity_once(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Northside Electrical"}).json()

    authed_client.post(f"/api/v1/leads/{lead['id']}/archive")
    authed_client.post(f"/api/v1/leads/{lead['id']}/archive")  # re-archiving is a no-op, not an error

    activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "lead", "entity_id": lead["id"]}
    ).json()
    assert sum(1 for a in activity if a["action"] == "archived") == 1


def test_unarchive_lead_is_idempotent(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Northside Electrical"}).json()
    authed_client.post(f"/api/v1/leads/{lead['id']}/archive")

    authed_client.post(f"/api/v1/leads/{lead['id']}/unarchive")
    res = authed_client.post(f"/api/v1/leads/{lead['id']}/unarchive")  # already unarchived — still a no-op

    assert res.status_code == 200
    assert res.json()["archived_at"] is None
    activity = authed_client.get(
        "/api/v1/activity", params={"entity_type": "lead", "entity_id": lead["id"]}
    ).json()
    assert sum(1 for a in activity if a["action"] == "unarchived") == 1


def test_archiving_a_converted_lead_preserves_client_and_project(authed_client):
    """Archiving is a Lead-list visibility state — it must never cascade
    into hiding or altering a Client/Project that already exists for the
    same business (downstream-data protection)."""
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Riverside Plumbing"}).json()
    client = authed_client.post("/api/v1/clients", json={"from_lead_id": lead["id"]}).json()
    projects = authed_client.get("/api/v1/projects").json()
    project = next(p for p in projects if p["client_id"] == client["id"])

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/archive")
    assert res.status_code == 200
    assert res.json()["archived_at"] is not None
    assert res.json()["status"] == "won"  # unchanged by archiving

    client_after = authed_client.get(f"/api/v1/clients/{client['id']}").json()
    assert client_after["id"] == client["id"]
    project_after = authed_client.get(f"/api/v1/projects/{project['id']}").json()
    assert project_after["id"] == project["id"]
    assert project_after["source_lead_id"] == lead["id"]


def test_archived_leads_excluded_from_sales_dashboard_counts(authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Northside Electrical"}).json()
    authed_client.post(f"/api/v1/leads/{lead['id']}/archive")

    body = authed_client.get("/api/v1/dashboard/sales").json()
    assert body["new_leads_count"] == 0


def test_archive_lead_is_workspace_scoped(authed_client, other_authed_client):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Northside Electrical"}).json()

    res = other_authed_client.post(f"/api/v1/leads/{lead['id']}/archive")
    assert res.status_code == 404

    # Untouched from the owning workspace's point of view.
    still_active = authed_client.get(f"/api/v1/leads/{lead['id']}").json()
    assert still_active["archived_at"] is None
