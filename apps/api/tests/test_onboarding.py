def _create_project(authed_client) -> str:
    client_id = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()["id"]
    project = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Coastal Cafe site"}
    ).json()
    return project["id"]


def test_get_checklist_seeds_defaults_on_first_touch(authed_client):
    project_id = _create_project(authed_client)

    res = authed_client.get(f"/api/v1/projects/{project_id}/onboarding")
    assert res.status_code == 200
    body = res.json()
    assert body["project_id"] == project_id
    # One default item per category — nothing is checked off yet.
    assert body["total_items"] == 15
    assert body["done_items"] == 0
    assert body["not_applicable_items"] == 0
    assert body["percent_complete"] == 0
    categories = {c["category"] for c in body["categories"]}
    assert categories == {
        "client_information", "project_type", "goals", "target_audience", "services", "branding",
        "existing_assets", "domain", "hosting", "required_pages", "functionality", "content",
        "deadlines", "budget", "approvals",
    }

    # Fetching again doesn't duplicate the seed.
    again = authed_client.get(f"/api/v1/projects/{project_id}/onboarding").json()
    assert again["total_items"] == 15


def test_get_checklist_unknown_project_404s(authed_client):
    res = authed_client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/onboarding")
    assert res.status_code == 404


def test_marking_item_done_updates_progress(authed_client):
    project_id = _create_project(authed_client)
    checklist = authed_client.get(f"/api/v1/projects/{project_id}/onboarding").json()
    item_id = checklist["items"][0]["id"]

    res = authed_client.patch(f"/api/v1/onboarding-items/{item_id}", json={"status": "done"})
    assert res.status_code == 200
    body = res.json()
    assert body["done_items"] == 1
    assert body["percent_complete"] == round(100 / 15)
    updated_item = next(i for i in body["items"] if i["id"] == item_id)
    assert updated_item["status"] == "done"


def test_not_applicable_item_does_not_block_full_progress(authed_client):
    """Do not force every project into the same structure: an item that
    doesn't apply is skipped via not_applicable, not left pending
    forever, and a fully-skipped-or-done checklist reads as 100%."""
    project_id = _create_project(authed_client)
    checklist = authed_client.get(f"/api/v1/projects/{project_id}/onboarding").json()

    for item in checklist["items"]:
        status = "not_applicable" if item["category"] == "domain" else "done"
        res = authed_client.patch(f"/api/v1/onboarding-items/{item['id']}", json={"status": status})
        assert res.status_code == 200

    final = res.json()
    assert final["done_items"] == 14
    assert final["not_applicable_items"] == 1
    assert final["percent_complete"] == 100
    domain_progress = next(c for c in final["categories"] if c["category"] == "domain")
    assert domain_progress["complete"] is True


def test_add_custom_item(authed_client):
    project_id = _create_project(authed_client)
    authed_client.get(f"/api/v1/projects/{project_id}/onboarding")  # seed first

    res = authed_client.post(
        f"/api/v1/projects/{project_id}/onboarding/items",
        json={"category": "functionality", "label": "Set up a booking widget", "notes": "Client uses Calendly"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["total_items"] == 16
    custom = next(i for i in body["items"] if i["label"] == "Set up a booking widget")
    assert custom["is_custom"] is True
    assert custom["notes"] == "Client uses Calendly"


def test_add_custom_item_seeds_defaults_if_checklist_never_touched(authed_client):
    """A project whose checklist was never GET-ed yet still gets seeded
    before the custom item is appended, so total_items reflects both."""
    project_id = _create_project(authed_client)

    res = authed_client.post(
        f"/api/v1/projects/{project_id}/onboarding/items",
        json={"category": "budget", "label": "Confirm payment schedule"},
    )
    assert res.status_code == 201
    assert res.json()["total_items"] == 16


def test_delete_custom_item(authed_client):
    project_id = _create_project(authed_client)
    added = authed_client.post(
        f"/api/v1/projects/{project_id}/onboarding/items",
        json={"category": "content", "label": "Draft a temporary launch banner"},
    ).json()
    custom_item_id = next(i for i in added["items"] if i["is_custom"])["id"]

    res = authed_client.delete(f"/api/v1/onboarding-items/{custom_item_id}")
    assert res.status_code == 200
    assert res.json()["total_items"] == 15


def test_cannot_delete_a_default_item(authed_client):
    project_id = _create_project(authed_client)
    checklist = authed_client.get(f"/api/v1/projects/{project_id}/onboarding").json()
    default_item_id = checklist["items"][0]["id"]

    res = authed_client.delete(f"/api/v1/onboarding-items/{default_item_id}")
    assert res.status_code == 400


def test_update_unknown_item_404s(authed_client):
    res = authed_client.patch(
        "/api/v1/onboarding-items/00000000-0000-0000-0000-000000000000", json={"status": "done"}
    )
    assert res.status_code == 404


def test_checklist_isolated_by_workspace(authed_client, other_authed_client):
    project_id = _create_project(authed_client)
    authed_client.get(f"/api/v1/projects/{project_id}/onboarding")

    res = other_authed_client.get(f"/api/v1/projects/{project_id}/onboarding")
    assert res.status_code == 404
