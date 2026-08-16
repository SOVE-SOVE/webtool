def test_create_lead_with_assignment(authed_client, member_user):
    res = authed_client.post(
        "/api/v1/leads",
        json={"business_name": "Hilltop Roofing", "assigned_user_id": str(member_user.id)},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["assigned_user_id"] == str(member_user.id)
    assert body["assigned_user_name"] == member_user.name


def test_reassign_lead(authed_client, admin_user, member_user):
    lead = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()
    assert lead["assigned_user_id"] is None

    res = authed_client.patch(
        f"/api/v1/leads/{lead['id']}", json={"assigned_user_id": str(member_user.id)}
    )
    assert res.status_code == 200
    assert res.json()["assigned_user_id"] == str(member_user.id)

    unassign_res = authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"assigned_user_id": None})
    assert unassign_res.status_code == 200
    assert unassign_res.json()["assigned_user_id"] is None


def test_omitting_assigned_user_id_leaves_assignment_untouched(authed_client, member_user):
    lead = authed_client.post(
        "/api/v1/leads",
        json={"business_name": "Hilltop Roofing", "assigned_user_id": str(member_user.id)},
    ).json()

    res = authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"score": 50})
    assert res.status_code == 200
    assert res.json()["assigned_user_id"] == str(member_user.id)


def test_cannot_assign_lead_to_user_in_another_workspace(authed_client, other_admin_user):
    res = authed_client.post(
        "/api/v1/leads",
        json={"business_name": "Hilltop Roofing", "assigned_user_id": str(other_admin_user.id)},
    )
    assert res.status_code == 404


def test_assign_project_and_task(authed_client, member_user):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()

    project_res = authed_client.post(
        "/api/v1/projects",
        json={"client_id": client_row["id"], "name": "New site", "assigned_user_id": str(member_user.id)},
    )
    assert project_res.status_code == 201
    assert project_res.json()["assigned_user_id"] == str(member_user.id)

    task_res = authed_client.post(
        "/api/v1/tasks",
        json={
            "title": "Draft sitemap",
            "project_id": project_res.json()["id"],
            "assigned_user_id": str(member_user.id),
        },
    )
    assert task_res.status_code == 201
    assert task_res.json()["assigned_user_id"] == str(member_user.id)


def test_assign_client(authed_client, member_user):
    res = authed_client.post(
        "/api/v1/clients",
        json={"business_name": "Coastal Cafe", "assigned_user_id": str(member_user.id)},
    )
    assert res.status_code == 201
    client_id = res.json()["id"]
    assert res.json()["assigned_user_id"] == str(member_user.id)

    unassign_res = authed_client.patch(f"/api/v1/clients/{client_id}", json={"assigned_user_id": None})
    assert unassign_res.status_code == 200
    assert unassign_res.json()["assigned_user_id"] is None


def test_member_can_assign_leads_too(member_client, member_user):
    """MEMBER role can create/edit leads per docs/01_REQUIREMENTS.md — assignment isn't admin-only."""
    res = member_client.post(
        "/api/v1/leads",
        json={"business_name": "Hilltop Roofing", "assigned_user_id": str(member_user.id)},
    )
    assert res.status_code == 201
