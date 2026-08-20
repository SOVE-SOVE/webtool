def test_list_users_requires_auth(client):
    res = client.get("/api/v1/users")
    assert res.status_code == 401


def test_admin_can_create_member(authed_client):
    res = authed_client.post(
        "/api/v1/users",
        json={"name": "New Teammate", "email": "teammate@example.com", "password": "hunter2-hunter2", "role": "member"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "New Teammate"
    assert body["role"] == "member"
    assert "password" not in body
    assert "password_hash" not in body


def test_member_cannot_create_user(member_client):
    res = member_client.post(
        "/api/v1/users",
        json={"name": "X", "email": "x@example.com", "password": "hunter2-hunter2"},
    )
    assert res.status_code == 403


def test_creating_user_with_duplicate_email_conflicts(authed_client, admin_user):
    res = authed_client.post(
        "/api/v1/users",
        json={"name": "Dup", "email": admin_user.email, "password": "hunter2-hunter2"},
    )
    assert res.status_code == 409


def test_new_user_can_log_in(authed_client, client):
    authed_client.post(
        "/api/v1/users",
        json={"name": "New Teammate", "email": "teammate@example.com", "password": "hunter2-hunter2", "role": "member"},
    )

    login_res = client.post(
        "/api/v1/auth/login", json={"email": "teammate@example.com", "password": "hunter2-hunter2"}
    )
    assert login_res.status_code == 200
    assert login_res.json()["role"] == "member"


def test_list_users_shows_workspace_members_not_other_workspaces(
    authed_client, member_client, other_authed_client
):
    """Any workspace member (not just admins) can see the member list — assignment needs it."""
    member_res = member_client.get("/api/v1/users")
    assert member_res.status_code == 200
    emails = [u["email"] for u in member_res.json()]
    assert "admin@example.com" in emails
    assert "member@example.com" in emails

    other_res = other_authed_client.get("/api/v1/users").json()
    other_emails = [u["email"] for u in other_res]
    assert "admin@example.com" not in other_emails


def test_admin_can_change_member_role(authed_client, member_user):
    res = authed_client.patch(f"/api/v1/users/{member_user.id}", json={"role": "admin"})
    assert res.status_code == 200
    assert res.json()["role"] == "admin"


def test_member_cannot_change_role(member_client, admin_user):
    res = member_client.patch(f"/api/v1/users/{admin_user.id}", json={"role": "member"})
    assert res.status_code == 403


def test_admin_cannot_change_role_of_user_in_other_workspace(authed_client, other_admin_user):
    res = authed_client.patch(f"/api/v1/users/{other_admin_user.id}", json={"role": "member"})
    assert res.status_code == 404


def test_cannot_demote_the_workspaces_only_admin(authed_client, admin_user):
    """A workspace with no admin can never add users, restore a role, or
    change workspace settings again — there's no signup or super-admin
    to recover from it."""
    res = authed_client.patch(f"/api/v1/users/{admin_user.id}", json={"role": "member"})
    assert res.status_code == 400
    assert "only admin" in res.json()["detail"]
    assert authed_client.get("/api/v1/auth/me").json()["role"] == "admin"


def test_can_demote_an_admin_once_another_admin_exists(authed_client, admin_user, member_user):
    authed_client.patch(f"/api/v1/users/{member_user.id}", json={"role": "admin"})
    res = authed_client.patch(f"/api/v1/users/{admin_user.id}", json={"role": "member"})
    assert res.status_code == 200
    assert res.json()["role"] == "member"


def test_password_shorter_than_the_minimum_is_rejected(authed_client):
    res = authed_client.post(
        "/api/v1/users",
        json={"name": "Weak", "email": "weak@example.com", "password": "short", "role": "member"},
    )
    assert res.status_code == 422


def test_empty_password_is_rejected(authed_client):
    res = authed_client.post(
        "/api/v1/users",
        json={"name": "Blank", "email": "blank@example.com", "password": "", "role": "member"},
    )
    assert res.status_code == 422
