def test_get_workspace_requires_auth(client):
    res = client.get("/api/v1/workspace")
    assert res.status_code == 401


def test_get_workspace(authed_client):
    res = authed_client.get("/api/v1/workspace")
    assert res.status_code == 200
    assert res.json()["name"] == "Acme Web Design"


def test_admin_can_rename_workspace(authed_client):
    res = authed_client.patch("/api/v1/workspace", json={"name": "New Name Web Design"})
    assert res.status_code == 200
    assert res.json()["name"] == "New Name Web Design"

    get_res = authed_client.get("/api/v1/workspace")
    assert get_res.json()["name"] == "New Name Web Design"


def test_member_cannot_rename_workspace(member_client):
    res = member_client.patch("/api/v1/workspace", json={"name": "Hijacked"})
    assert res.status_code == 403


def test_renaming_workspace_does_not_affect_other_workspaces(authed_client, other_authed_client):
    authed_client.patch("/api/v1/workspace", json={"name": "Renamed"})

    other_res = other_authed_client.get("/api/v1/workspace")
    assert other_res.json()["name"] == "Other Business"
