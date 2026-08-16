from app.core.settings import settings


def test_login_wrong_password_fails(client):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": settings.operator_email, "password": "wrong"},
    )
    assert res.status_code == 401


def test_login_unknown_email_fails(client, operator_password):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "someone-else@example.com", "password": operator_password},
    )
    assert res.status_code == 401


def test_login_correct_password_succeeds(client, operator_password):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": settings.operator_email, "password": operator_password},
    )
    assert res.status_code == 200
    assert res.json() == {"email": settings.operator_email}
    assert settings.session_cookie_name in res.cookies


def test_me_requires_auth(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401


def test_me_with_session(client, operator_password):
    client.post(
        "/api/v1/auth/login",
        json={"email": settings.operator_email, "password": operator_password},
    )
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 200
    assert res.json()["email"] == settings.operator_email


def test_logout_clears_session(client, operator_password):
    client.post(
        "/api/v1/auth/login",
        json={"email": settings.operator_email, "password": operator_password},
    )
    logout_res = client.post("/api/v1/auth/logout")
    assert logout_res.status_code == 204

    me_res = client.get("/api/v1/auth/me")
    assert me_res.status_code == 401
