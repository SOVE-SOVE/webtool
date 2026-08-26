"""
Security tests for the client portal foundation (app/modules/portal).
Client accounts must:
  - authenticate only via their own session namespace (own cookie name,
    own itsdangerous salt — see app/modules/portal/auth.py), never via
    or as an internal user session;
  - see only their own client's data, never another client's;
  - never reach any internal/sales-only route, regardless of how valid
    their portal session is.
See docs/06_SECURITY.md for the isolation rationale this exercises.
"""

from fastapi.testclient import TestClient

from app.main import app


def _create_client_and_project(authed_client, business_name="Portal Co"):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": business_name}).json()
    project = authed_client.post(
        "/api/v1/projects",
        json={"client_id": client_row["id"], "name": "Their Website", "price_cents": 99900},
    ).json()
    return client_row, project


def _create_portal_user(authed_client, client_id, email="client@example.com"):
    res = authed_client.post(
        f"/api/v1/clients/{client_id}/portal-users", json={"email": email, "name": "Client Contact"}
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["email"], body["temporary_password"]


def _portal_login(email, password):
    c = TestClient(app)
    res = c.post("/api/v1/portal/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return c


def test_portal_user_creation_is_admin_only(authed_client, member_client):
    client_row, _ = _create_client_and_project(authed_client)
    res = member_client.post(
        f"/api/v1/clients/{client_row['id']}/portal-users", json={"email": "x@example.com", "name": "X"}
    )
    assert res.status_code == 403


def test_portal_login_and_me(authed_client):
    client_row, _ = _create_client_and_project(authed_client)
    email, password = _create_portal_user(authed_client, client_row["id"])
    portal_client = _portal_login(email, password)

    me = portal_client.get("/api/v1/portal/auth/me")
    assert me.status_code == 200
    assert me.json()["client_id"] == client_row["id"]
    assert me.json()["business_name"] == "Portal Co"


def test_portal_login_rejects_wrong_password(authed_client):
    client_row, _ = _create_client_and_project(authed_client)
    email, _ = _create_portal_user(authed_client, client_row["id"])
    c = TestClient(app)
    res = c.post("/api/v1/portal/auth/login", json={"email": email, "password": "wrong-password"})
    assert res.status_code == 401


def test_inactive_portal_user_cannot_log_in(authed_client):
    client_row, _ = _create_client_and_project(authed_client)
    email, password = _create_portal_user(authed_client, client_row["id"])
    portal_users = authed_client.get(f"/api/v1/clients/{client_row['id']}/portal-users").json()
    portal_user_id = portal_users[0]["id"]
    deact = authed_client.patch(
        f"/api/v1/clients/{client_row['id']}/portal-users/{portal_user_id}", json={"is_active": False}
    )
    assert deact.status_code == 200

    c = TestClient(app)
    res = c.post("/api/v1/portal/auth/login", json={"email": email, "password": password})
    assert res.status_code == 401


def test_portal_user_sees_only_own_project_status(authed_client):
    client_row, project = _create_client_and_project(authed_client)
    email, password = _create_portal_user(authed_client, client_row["id"])
    portal_client = _portal_login(email, password)

    projects = portal_client.get("/api/v1/portal/projects").json()
    assert len(projects) == 1
    assert projects[0]["id"] == project["id"]
    assert projects[0]["stage"] == "intake"

    detail = portal_client.get(f"/api/v1/portal/projects/{project['id']}")
    assert detail.status_code == 200


def test_portal_project_response_excludes_commercial_and_staffing_fields(authed_client):
    client_row, project = _create_client_and_project(authed_client)
    email, password = _create_portal_user(authed_client, client_row["id"])
    portal_client = _portal_login(email, password)

    body = portal_client.get(f"/api/v1/portal/projects/{project['id']}").json()
    for forbidden_field in ("price_cents", "assigned_user_id", "assigned_user_name", "source_lead_id"):
        assert forbidden_field not in body


def test_portal_user_cannot_see_a_different_clients_project(authed_client):
    client_a, project_a = _create_client_and_project(authed_client, "Client A")
    client_b, project_b = _create_client_and_project(authed_client, "Client B")
    email_a, password_a = _create_portal_user(authed_client, client_a["id"], "a@example.com")
    portal_a = _portal_login(email_a, password_a)

    listed = portal_a.get("/api/v1/portal/projects").json()
    assert [p["id"] for p in listed] == [project_a["id"]]

    other_get = portal_a.get(f"/api/v1/portal/projects/{project_b['id']}")
    assert other_get.status_code == 404


def test_portal_session_cookie_does_not_authenticate_internal_routes(authed_client):
    client_row, _ = _create_client_and_project(authed_client)
    email, password = _create_portal_user(authed_client, client_row["id"])
    portal_client = _portal_login(email, password)

    # The portal cookie is real and valid for portal routes...
    assert portal_client.get("/api/v1/portal/auth/me").status_code == 200
    # ...but carries no weight at all against internal-user routes, even
    # though both ride the same TestClient cookie jar / browser.
    assert portal_client.get("/api/v1/auth/me").status_code == 401
    assert portal_client.get("/api/v1/clients").status_code == 401
    assert portal_client.get("/api/v1/leads").status_code == 401


def test_internal_session_cookie_does_not_authenticate_portal_routes(authed_client):
    # authed_client only ever held the internal wdos_session cookie.
    assert authed_client.get("/api/v1/auth/me").status_code == 200
    assert authed_client.get("/api/v1/portal/auth/me").status_code == 401
    assert authed_client.get("/api/v1/portal/projects").status_code == 401


def test_portal_user_cannot_reach_any_internal_sales_route(authed_client):
    client_row, _ = _create_client_and_project(authed_client)
    email, password = _create_portal_user(authed_client, client_row["id"])
    portal_client = _portal_login(email, password)

    # Internal-sales-only / internal-admin data that must never be
    # reachable by a client role, no matter how valid its own session
    # is — see docs/06_SECURITY.md's client-portal isolation entry.
    internal_only_routes = [
        "/api/v1/leads",
        "/api/v1/pipeline/stages",
        "/api/v1/dashboard/sales",
        "/api/v1/dashboard/overview",
        "/api/v1/discovery-searches",
        "/api/v1/businesses",
        "/api/v1/users",
        "/api/v1/workspace",
        "/api/v1/activity",
        "/api/v1/clients",
        "/api/v1/projects",
    ]
    for path in internal_only_routes:
        res = portal_client.get(path)
        assert res.status_code == 401, f"{path} returned {res.status_code}, expected 401"


def test_portal_change_password(authed_client):
    client_row, _ = _create_client_and_project(authed_client)
    email, password = _create_portal_user(authed_client, client_row["id"])
    portal_client = _portal_login(email, password)

    res = portal_client.post(
        "/api/v1/portal/auth/change-password",
        json={"current_password": password, "new_password": "a-new-strong-password"},
    )
    assert res.status_code == 204

    old = TestClient(app).post("/api/v1/portal/auth/login", json={"email": email, "password": password})
    assert old.status_code == 401

    new = TestClient(app).post(
        "/api/v1/portal/auth/login", json={"email": email, "password": "a-new-strong-password"}
    )
    assert new.status_code == 200


def test_portal_change_password_rejects_wrong_current_password(authed_client):
    client_row, _ = _create_client_and_project(authed_client)
    email, password = _create_portal_user(authed_client, client_row["id"])
    portal_client = _portal_login(email, password)

    res = portal_client.post(
        "/api/v1/portal/auth/change-password",
        json={"current_password": "not-the-real-password", "new_password": "a-new-strong-password"},
    )
    assert res.status_code == 401


def test_creating_portal_user_scoped_to_workspace(authed_client, other_authed_client):
    client_row, _ = _create_client_and_project(authed_client)
    res = other_authed_client.post(
        f"/api/v1/clients/{client_row['id']}/portal-users", json={"email": "hijack@example.com", "name": "X"}
    )
    assert res.status_code == 404


def test_portal_user_email_must_be_unique(authed_client):
    client_a, _ = _create_client_and_project(authed_client, "Client A")
    client_b, _ = _create_client_and_project(authed_client, "Client B")
    _create_portal_user(authed_client, client_a["id"], "dup@example.com")
    res = authed_client.post(
        f"/api/v1/clients/{client_b['id']}/portal-users", json={"email": "dup@example.com", "name": "Y"}
    )
    assert res.status_code == 409
