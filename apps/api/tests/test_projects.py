def _create_client(authed_client, name: str = "Coastal Cafe") -> str:
    res = authed_client.post("/api/v1/clients", json={"business_name": name})
    return res.json()["id"]


def test_create_and_list_projects(authed_client):
    client_id = _create_client(authed_client)

    res = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "New website"
    assert body["stage"] == "intake"
    assert body["client_business_name"] == "Coastal Cafe"

    list_res = authed_client.get("/api/v1/projects")
    assert len(list_res.json()) == 1


def test_create_project_unknown_client_404s(authed_client):
    res = authed_client.post(
        "/api/v1/projects",
        json={"client_id": "00000000-0000-0000-0000-000000000000", "name": "New website"},
    )
    assert res.status_code == 404


def test_update_project_stage(authed_client):
    client_id = _create_client(authed_client)
    create_res = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"})
    project_id = create_res.json()["id"]

    patch_res = authed_client.patch(f"/api/v1/projects/{project_id}", json={"stage": "brief"})
    assert patch_res.status_code == 200
    assert patch_res.json()["stage"] == "brief"


def test_project_stage_covers_full_pipeline(authed_client):
    client_id = _create_client(authed_client)
    create_res = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "New website"})
    project_id = create_res.json()["id"]

    full_pipeline = [
        "intake", "research", "brief", "design", "development", "qa",
        "client_review", "revisions", "ready_to_deploy", "deployed",
        "maintenance", "complete",
    ]
    for stage in full_pipeline:
        res = authed_client.patch(f"/api/v1/projects/{project_id}", json={"stage": stage})
        assert res.status_code == 200
        assert res.json()["stage"] == stage


def test_project_agreed_terms_settable_and_editable(authed_client):
    client_id = _create_client(authed_client)
    create_res = authed_client.post(
        "/api/v1/projects",
        json={
            "client_id": client_id,
            "name": "New website",
            "package": "Core",
            "price_cents": 89900,
            "deadline": "2026-10-01",
        },
    )
    body = create_res.json()
    assert body["package"] == "Core"
    assert body["price_cents"] == 89900
    assert body["deadline"] == "2026-10-01"
    assert body["source_lead_id"] is None

    patch_res = authed_client.patch(
        f"/api/v1/projects/{body['id']}", json={"price_cents": 99900, "deadline": None}
    )
    patched = patch_res.json()
    assert patched["price_cents"] == 99900
    assert patched["deadline"] is None
    assert patched["package"] == "Core"
