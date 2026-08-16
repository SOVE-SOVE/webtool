from app.core.settings import settings


def _login(client, operator_password: str) -> None:
    res = client.post(
        "/api/v1/auth/login",
        json={"email": settings.operator_email, "password": operator_password},
    )
    assert res.status_code == 200


def test_list_businesses_requires_auth(client):
    res = client.get("/api/v1/businesses")
    assert res.status_code == 401


def test_create_and_list_business(client, operator_password):
    _login(client, operator_password)

    create_res = client.post(
        "/api/v1/businesses",
        json={"name": "Riverside Plumbing", "industry": "plumbing", "suburb": "Geelong", "state": "VIC"},
    )
    assert create_res.status_code == 201
    body = create_res.json()
    assert body["name"] == "Riverside Plumbing"
    assert body["industry"] == "plumbing"
    assert body["id"]

    list_res = client.get("/api/v1/businesses")
    assert list_res.status_code == 200
    names = [b["name"] for b in list_res.json()]
    assert "Riverside Plumbing" in names


def test_get_business_by_id(client, operator_password):
    _login(client, operator_password)

    create_res = client.post("/api/v1/businesses", json={"name": "Northside Electrical"})
    business_id = create_res.json()["id"]

    get_res = client.get(f"/api/v1/businesses/{business_id}")
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "Northside Electrical"


def test_get_business_not_found(client, operator_password):
    _login(client, operator_password)

    res = client.get("/api/v1/businesses/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
