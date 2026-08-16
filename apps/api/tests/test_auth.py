def test_login_wrong_password_fails(client, admin_user):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": admin_user.email, "password": "wrong"},
    )
    assert res.status_code == 401


def test_login_unknown_email_fails(client, admin_password):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": "someone-else@example.com", "password": admin_password},
    )
    assert res.status_code == 401


def test_login_correct_password_succeeds(client, admin_user, admin_password):
    res = client.post(
        "/api/v1/auth/login",
        json={"email": admin_user.email, "password": admin_password},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == admin_user.email
    assert body["role"] == "admin"
    assert body["workspace_id"] == str(admin_user.workspace_id)
    assert "wdos_session" in res.cookies


def test_me_requires_auth(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401


def test_me_with_session(client, admin_user, admin_password):
    client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": admin_password})
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == admin_user.email
    assert body["workspace_name"] == "Acme Web Design"


def test_logout_clears_session(client, admin_user, admin_password):
    client.post("/api/v1/auth/login", json={"email": admin_user.email, "password": admin_password})
    logout_res = client.post("/api/v1/auth/logout")
    assert logout_res.status_code == 204

    me_res = client.get("/api/v1/auth/me")
    assert me_res.status_code == 401
