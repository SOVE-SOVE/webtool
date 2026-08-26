"""
The final "mark project delivered" step of the delivery workflow
(phase 6 part 2, Task 2): approve -> deploy -> monitor -> receive URL
-> verify -> deliver. Reuses `_build_deployable_project` from
tests/test_deployments.py (every prior approval checkpoint satisfied)
rather than re-deriving that setup here.
"""

from app.modules.projects.service import DEFAULT_LAUNCH_TASK_TITLES
from tests.test_deployments import _build_deployable_project


def _deploy_and_verify(authed_client, project_id):
    prepared = authed_client.post(f"/api/v1/projects/{project_id}/deployments").json()
    executed = authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute").json()
    assert executed["status"] == "success"
    authed_client.post(f"/api/v1/deployments/{executed['id']}/verify")
    return executed


def _complete_delivery_checklist(authed_client, project_id):
    tasks = authed_client.get("/api/v1/tasks").json()
    checklist = [t for t in tasks if t["project_id"] == project_id and t["title"] in DEFAULT_LAUNCH_TASK_TITLES]
    assert len(checklist) == len(DEFAULT_LAUNCH_TASK_TITLES)
    for task in checklist:
        res = authed_client.patch(f"/api/v1/tasks/{task['id']}", json={"done": True})
        assert res.status_code == 200


class TestDeliveryStatus:
    def test_requires_auth(self, client):
        res = client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/delivery-status")
        assert res.status_code == 401

    def test_unknown_project_404s(self, authed_client):
        res = authed_client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000/delivery-status")
        assert res.status_code == 404

    def test_reports_every_missing_thing_before_any_deployment(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)

        res = authed_client.get(f"/api/v1/projects/{project['id']}/delivery-status")
        assert res.status_code == 200
        body = res.json()
        assert body["can_deliver"] is False
        assert body["has_successful_deployment"] is False
        assert body["deployment_verified"] is False
        assert body["checklist"] == []

    def test_deployed_but_unverified_still_blocks_delivery(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        prepared = authed_client.post(f"/api/v1/projects/{project['id']}/deployments").json()
        authed_client.post(f"/api/v1/deployments/{prepared['id']}/execute")

        status = authed_client.get(f"/api/v1/projects/{project['id']}/delivery-status").json()
        assert status["has_successful_deployment"] is True
        assert status["deployment_verified"] is False
        assert status["can_deliver"] is False
        assert any("verification" in m for m in status["missing"])

    def test_checklist_reflects_task_completion(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        _deploy_and_verify(authed_client, project["id"])

        status = authed_client.get(f"/api/v1/projects/{project['id']}/delivery-status").json()
        assert status["deployment_verified"] is True
        assert len(status["checklist"]) == len(DEFAULT_LAUNCH_TASK_TITLES)
        assert all(not item["done"] for item in status["checklist"])
        assert status["can_deliver"] is False

        _complete_delivery_checklist(authed_client, project["id"])

        status_after = authed_client.get(f"/api/v1/projects/{project['id']}/delivery-status").json()
        assert all(item["done"] for item in status_after["checklist"])
        assert status_after["can_deliver"] is True
        assert status_after["missing"] == []


class TestMarkDelivered:
    def test_requires_auth(self, client):
        res = client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/deliver")
        assert res.status_code == 401

    def test_unknown_project_404s(self, authed_client):
        res = authed_client.post("/api/v1/projects/00000000-0000-0000-0000-000000000000/deliver")
        assert res.status_code == 404

    def test_refuses_when_not_yet_ready(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        res = authed_client.post(f"/api/v1/projects/{project['id']}/deliver")
        assert res.status_code == 400
        assert "successful deployment" in res.json()["detail"]

    def test_happy_path_marks_delivered_and_advances_to_complete(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        _deploy_and_verify(authed_client, project["id"])
        _complete_delivery_checklist(authed_client, project["id"])

        res = authed_client.post(f"/api/v1/projects/{project['id']}/deliver")
        assert res.status_code == 200
        body = res.json()
        assert body["delivered_at"] is not None
        assert body["delivered_by_user_name"] == "Ada Admin"
        assert body["stage"] == "complete"

        activity = authed_client.get(f"/api/v1/activity?entity_type=project&entity_id={project['id']}").json()
        assert any(a["action"] == "project_delivered" for a in activity)

    def test_cannot_deliver_the_same_project_twice(self, authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        _deploy_and_verify(authed_client, project["id"])
        _complete_delivery_checklist(authed_client, project["id"])
        authed_client.post(f"/api/v1/projects/{project['id']}/deliver")

        res = authed_client.post(f"/api/v1/projects/{project['id']}/deliver")
        assert res.status_code == 400
        assert "already been marked delivered" in res.json()["detail"]

    def test_workspace_isolated(self, authed_client, other_authed_client, monkeypatch):
        project, _ = _build_deployable_project(authed_client, monkeypatch)
        _deploy_and_verify(authed_client, project["id"])
        _complete_delivery_checklist(authed_client, project["id"])

        res = other_authed_client.post(f"/api/v1/projects/{project['id']}/deliver")
        assert res.status_code == 404
