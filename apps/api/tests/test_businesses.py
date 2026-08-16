def test_list_businesses_requires_auth(client):
    res = client.get("/api/v1/businesses")
    assert res.status_code == 401


def test_create_and_list_business(authed_client):
    create_res = authed_client.post(
        "/api/v1/businesses",
        json={"name": "Riverside Plumbing", "industry": "plumbing", "suburb": "Geelong", "state": "VIC"},
    )
    assert create_res.status_code == 201
    body = create_res.json()
    assert body["name"] == "Riverside Plumbing"
    assert body["industry"] == "plumbing"
    assert body["id"]

    list_res = authed_client.get("/api/v1/businesses")
    assert list_res.status_code == 200
    names = [b["name"] for b in list_res.json()]
    assert "Riverside Plumbing" in names


def test_get_business_by_id(authed_client):
    create_res = authed_client.post("/api/v1/businesses", json={"name": "Northside Electrical"})
    business_id = create_res.json()["id"]

    get_res = authed_client.get(f"/api/v1/businesses/{business_id}")
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "Northside Electrical"


def test_get_business_not_found(authed_client):
    res = authed_client.get("/api/v1/businesses/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


def test_business_scoped_to_own_workspace(authed_client, other_authed_client):
    """A business created in one workspace is invisible to another workspace's admin."""
    create_res = authed_client.post("/api/v1/businesses", json={"name": "Workspace One Business"})
    business_id = create_res.json()["id"]

    other_list = other_authed_client.get("/api/v1/businesses").json()
    assert business_id not in [b["id"] for b in other_list]

    other_get = other_authed_client.get(f"/api/v1/businesses/{business_id}")
    assert other_get.status_code == 404
