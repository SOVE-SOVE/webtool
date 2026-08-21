def _create_client(authed_client, name: str = "Coastal Cafe") -> str:
    res = authed_client.post("/api/v1/clients", json={"business_name": name})
    return res.json()["id"]


def test_start_intake_creates_project_and_draft_brief(authed_client):
    client_id = _create_client(authed_client)

    res = authed_client.post(
        f"/api/v1/clients/{client_id}/intake",
        json={"business_name": "Coastal Cafe", "industry": "Hospitality"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "draft"
    assert body["business"]["fields"]["business_name"] == "Coastal Cafe"
    assert body["business"]["fields"]["industry"] == "Hospitality"

    project_id = body["project_id"]
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["stage"] == "intake"
    assert project["name"] == "Coastal Cafe — Website"


def test_start_intake_unknown_client_404s(authed_client):
    res = authed_client.post(
        "/api/v1/clients/00000000-0000-0000-0000-000000000000/intake", json={}
    )
    assert res.status_code == 404


def test_start_intake_custom_project_name(authed_client):
    client_id = _create_client(authed_client)
    res = authed_client.post(
        f"/api/v1/clients/{client_id}/intake", json={"project_name": "Coastal Cafe Rebrand"}
    )
    project_id = res.json()["project_id"]
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["name"] == "Coastal Cafe Rebrand"


def test_get_brief_auto_creates_empty_draft_for_existing_project(authed_client):
    client_id = _create_client(authed_client)
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Coastal Cafe site"}
    ).json()

    res = authed_client.get(f"/api/v1/projects/{project['id']}/brief")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "draft"
    assert body["project_id"] == project["id"]
    # Nothing has been filled in yet — every tracked field is missing.
    assert len(body["missing_fields"]) == 35
    assert "Business > Business name" in body["missing_fields"]
    assert "Assets > Logos" in body["missing_fields"]


def test_get_brief_unknown_project_404s(authed_client):
    res = authed_client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/brief")
    assert res.status_code == 404


def test_missing_fields_shrinks_as_fields_are_filled(authed_client):
    client_id = _create_client(authed_client)
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Coastal Cafe site"}
    ).json()

    before = authed_client.get(f"/api/v1/projects/{project['id']}/brief").json()
    assert "Business > Business name" in before["missing_fields"]

    patch_res = authed_client.patch(
        f"/api/v1/projects/{project['id']}/brief",
        json={"business_name": "Coastal Cafe", "brand_colours": "Teal\nSand"},
    )
    assert patch_res.status_code == 200
    after = patch_res.json()
    assert "Business > Business name" not in after["missing_fields"]
    assert "Brand > Colours" not in after["missing_fields"]
    assert after["business"]["fields"]["business_name"] == "Coastal Cafe"
    assert after["brand"]["fields"]["brand_colours"] == ["Teal", "Sand"]
    assert len(after["missing_fields"]) == len(before["missing_fields"]) - 2


def test_update_brief_does_not_fabricate_unset_fields(authed_client):
    """Setting one field must never invent values for the others — an
    unanswered question stays null, never a guessed placeholder."""
    client_id = _create_client(authed_client)
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Coastal Cafe site"}
    ).json()

    body = authed_client.patch(
        f"/api/v1/projects/{project['id']}/brief", json={"business_name": "Coastal Cafe"}
    ).json()
    assert body["business"]["fields"]["business_description"] is None
    assert body["brand"]["fields"]["brand_colours"] == []


def test_approve_brief_advances_project_stage(authed_client):
    client_id = _create_client(authed_client)
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Coastal Cafe site"}
    ).json()
    authed_client.patch(
        f"/api/v1/projects/{project['id']}/brief", json={"business_name": "Coastal Cafe"}
    )

    res = authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "approved"
    assert body["approved_at"] is not None

    updated_project = authed_client.get(f"/api/v1/projects/{project['id']}").json()
    assert updated_project["stage"] == "brief"


def test_editing_approved_brief_reverts_to_draft(authed_client):
    client_id = _create_client(authed_client)
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Coastal Cafe site"}
    ).json()
    authed_client.patch(
        f"/api/v1/projects/{project['id']}/brief", json={"business_name": "Coastal Cafe"}
    )
    authed_client.post(f"/api/v1/projects/{project['id']}/brief/approve")

    res = authed_client.patch(
        f"/api/v1/projects/{project['id']}/brief", json={"business_name": "Coastal Cafe & Bakery"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "draft"
    assert body["approved_at"] is None


def test_approve_unknown_project_404s(authed_client):
    res = authed_client.post(
        "/api/v1/projects/00000000-0000-0000-0000-000000000000/brief/approve"
    )
    assert res.status_code == 404


# --- duplicate-project guard ------------------------------------------
#
# "Start intake" used to create a brand new Project on every click, with
# no guard and no way to delete the duplicates. See
# docs/05_DECISIONS.md (2026-08-21).


def _project_ids(authed_client, client_id):
    return [p["id"] for p in authed_client.get("/api/v1/projects").json() if p["client_id"] == client_id]


def test_start_intake_twice_reuses_the_existing_project(authed_client):
    client_id = _create_client(authed_client)

    first = authed_client.post(f"/api/v1/clients/{client_id}/intake", json={"business_name": "Coastal Cafe"}).json()
    second = authed_client.post(f"/api/v1/clients/{client_id}/intake", json={"business_name": "Coastal Cafe"}).json()

    assert second["project_id"] == first["project_id"]
    assert len(_project_ids(authed_client, client_id)) == 1


def test_repeat_intake_fills_gaps_without_overwriting_operator_answers(authed_client):
    client_id = _create_client(authed_client)
    brief = authed_client.post(
        f"/api/v1/clients/{client_id}/intake", json={"business_name": "Coastal Cafe"}
    ).json()
    project_id = brief["project_id"]
    authed_client.patch(f"/api/v1/projects/{project_id}/brief", json={"business_name": "Coastal Cafe Pty Ltd"})

    again = authed_client.post(
        f"/api/v1/clients/{client_id}/intake",
        json={"business_name": "Coastal Cafe", "industry": "Hospitality"},
    ).json()

    assert again["business"]["fields"]["business_name"] == "Coastal Cafe Pty Ltd"  # kept
    assert again["business"]["fields"]["industry"] == "Hospitality"  # gap filled


def test_force_new_starts_a_genuinely_additional_project(authed_client):
    client_id = _create_client(authed_client)
    first = authed_client.post(f"/api/v1/clients/{client_id}/intake", json={}).json()

    second = authed_client.post(
        f"/api/v1/clients/{client_id}/intake", json={"force_new": True, "project_name": "Coastal Cafe Rebrand"}
    ).json()

    assert second["project_id"] != first["project_id"]
    assert len(_project_ids(authed_client, client_id)) == 2


def test_a_finished_project_does_not_block_a_new_one(authed_client):
    client_id = _create_client(authed_client)
    first = authed_client.post(f"/api/v1/clients/{client_id}/intake", json={}).json()
    authed_client.patch(f"/api/v1/projects/{first['project_id']}", json={"stage": "complete"})

    second = authed_client.post(f"/api/v1/clients/{client_id}/intake", json={}).json()
    assert second["project_id"] != first["project_id"]


def test_start_intake_seeds_the_same_starter_checklist_as_a_lead_conversion(authed_client):
    from app.modules.projects.service import DEFAULT_INTAKE_TASK_TITLES

    client_id = _create_client(authed_client)
    brief = authed_client.post(f"/api/v1/clients/{client_id}/intake", json={}).json()

    tasks = [t for t in authed_client.get("/api/v1/tasks").json() if t["project_id"] == brief["project_id"]]
    assert sorted(t["title"] for t in tasks) == sorted(DEFAULT_INTAKE_TASK_TITLES)
