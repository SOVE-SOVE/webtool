def _create_lead(authed_client, name="Riverside Plumbing"):
    return authed_client.post("/api/v1/leads", json={"business_name": name}).json()


def test_list_pipeline_stages_requires_auth(client):
    res = client.get("/api/v1/pipeline/stages")
    assert res.status_code == 401


def test_list_pipeline_stages_seeds_sensible_defaults(authed_client):
    res = authed_client.get("/api/v1/pipeline/stages")
    assert res.status_code == 200
    stages = res.json()

    keys = [s["key"] for s in stages]
    assert keys == sorted(keys, key=lambda k: next(s["sort_order"] for s in stages if s["key"] == k))
    # every LeadStatus a lead can actually carry has a board column
    assert set(keys) == {
        "new", "researched", "qualified", "contacted", "replied",
        "meeting", "proposal", "won", "lost", "nurture",
    }

    by_key = {s["key"]: s for s in stages}
    assert by_key["new"]["label"] == "New"
    assert by_key["replied"]["label"] == "Responded"
    assert by_key["meeting"]["label"] == "Meeting booked"
    assert by_key["won"]["is_won"] is True
    assert by_key["lost"]["is_lost"] is True
    assert by_key["proposal"]["is_won"] is False and by_key["proposal"]["is_lost"] is False


def test_list_pipeline_stages_is_idempotent(authed_client):
    first = authed_client.get("/api/v1/pipeline/stages").json()
    second = authed_client.get("/api/v1/pipeline/stages").json()
    assert [s["id"] for s in first] == [s["id"] for s in second]


def test_update_pipeline_stage_label_and_order(authed_client):
    stages = authed_client.get("/api/v1/pipeline/stages").json()
    new_stage = next(s for s in stages if s["key"] == "new")

    res = authed_client.patch(
        f"/api/v1/pipeline/stages/{new_stage['id']}", json={"label": "Fresh prospect", "sort_order": 5}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["label"] == "Fresh prospect"
    assert body["sort_order"] == 5

    reread = authed_client.get("/api/v1/pipeline/stages").json()
    updated = next(s for s in reread if s["id"] == new_stage["id"])
    assert updated["label"] == "Fresh prospect"
    assert updated["sort_order"] == 5


def test_update_pipeline_stage_partial_leaves_other_field_untouched(authed_client):
    stages = authed_client.get("/api/v1/pipeline/stages").json()
    stage = next(s for s in stages if s["key"] == "contacted")

    res = authed_client.patch(f"/api/v1/pipeline/stages/{stage['id']}", json={"label": "Reached out"})
    assert res.status_code == 200
    assert res.json()["sort_order"] == stage["sort_order"]


def test_update_pipeline_stage_not_found_404s(authed_client):
    res = authed_client.patch(
        "/api/v1/pipeline/stages/00000000-0000-0000-0000-000000000000", json={"label": "x"}
    )
    assert res.status_code == 404


def test_pipeline_stages_workspace_scoped(authed_client, other_authed_client):
    stages = authed_client.get("/api/v1/pipeline/stages").json()
    stage = next(s for s in stages if s["key"] == "new")

    res = other_authed_client.patch(f"/api/v1/pipeline/stages/{stage['id']}", json={"label": "Hijacked"})
    assert res.status_code == 404

    other_stages = other_authed_client.get("/api/v1/pipeline/stages").json()
    other_new = next(s for s in other_stages if s["key"] == "new")
    assert other_new["id"] != stage["id"]
    assert other_new["label"] == "New"


def test_lead_pipeline_events_requires_auth(client):
    res = client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000/pipeline-events")
    assert res.status_code == 401


def test_lead_pipeline_events_empty_for_new_lead(authed_client):
    lead = _create_lead(authed_client)
    res = authed_client.get(f"/api/v1/leads/{lead['id']}/pipeline-events")
    assert res.status_code == 200
    assert res.json() == []


def test_lead_pipeline_events_not_found_404s(authed_client):
    res = authed_client.get("/api/v1/leads/00000000-0000-0000-0000-000000000000/pipeline-events")
    assert res.status_code == 404


def test_status_change_recorded_in_pipeline_events(authed_client):
    lead = _create_lead(authed_client)

    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified"})
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "contacted"})

    res = authed_client.get(f"/api/v1/leads/{lead['id']}/pipeline-events")
    assert res.status_code == 200
    events = res.json()
    assert len(events) == 2
    # newest first
    assert events[0]["summary"] == "qualified -> contacted"
    assert events[1]["summary"] == "new -> qualified"
    assert all(e["kind"] == "status_changed" for e in events)
    assert all(e["lead_id"] == lead["id"] for e in events)


def test_patching_lead_to_same_status_does_not_record_event(authed_client):
    lead = _create_lead(authed_client)
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "new"})
    events = authed_client.get(f"/api/v1/leads/{lead['id']}/pipeline-events").json()
    assert events == []


def test_lead_pipeline_events_workspace_scoped(authed_client, other_authed_client):
    lead = _create_lead(authed_client)
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": "qualified"})

    res = other_authed_client.get(f"/api/v1/leads/{lead['id']}/pipeline-events")
    assert res.status_code == 404


def test_full_pipeline_move_across_stages_preserves_lead_and_research(authed_client):
    """Discover → research (score/notes carried on the lead already, per
    the M2/Phase-2 workflow) → move the lead through the sales pipeline —
    every move keeps the lead's own fields intact."""
    lead = authed_client.post(
        "/api/v1/leads",
        json={"business_name": "Bayview Cafe", "industry": "hospitality", "source": "discovery:brave_search"},
    ).json()
    authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"score": 74, "notes": "Outdated site, no HTTPS"})

    for status in ["researched", "qualified", "contacted", "replied", "meeting", "proposal", "won"]:
        res = authed_client.patch(f"/api/v1/leads/{lead['id']}", json={"status": status})
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == status
        assert body["score"] == 74
        assert body["notes"] == "Outdated site, no HTTPS"
        assert body["business_name"] == "Bayview Cafe"

    events = authed_client.get(f"/api/v1/leads/{lead['id']}/pipeline-events").json()
    assert len(events) == 7
    assert events[0]["summary"] == "proposal -> won"
    assert events[-1]["summary"] == "new -> researched"
