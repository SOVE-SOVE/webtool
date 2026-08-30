from app.modules.contacts.models import Contact
from app.modules.interactions.models import Interaction, InteractionKind
from app.modules.outreach.models import OutreachChannel, OutreachMessage
from app.modules.sales_audits.models import SalesAuditReport
from app.modules.website_audits.models import WebsiteAudit


def test_create_client_directly(authed_client):
    res = authed_client.post(
        "/api/v1/clients",
        json={"business_name": "Coastal Cafe", "billing_email": "billing@coastalcafe.example"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["business_name"] == "Coastal Cafe"
    assert body["billing_email"] == "billing@coastalcafe.example"
    assert body["project_count"] == 0


def test_create_client_requires_exactly_one_source(authed_client):
    res = authed_client.post("/api/v1/clients", json={})
    assert res.status_code == 422

    res = authed_client.post(
        "/api/v1/clients",
        json={"business_name": "A", "from_lead_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert res.status_code == 422


def test_convert_lead_to_client_marks_lead_won(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    client_res = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id})
    assert client_res.status_code == 201
    assert client_res.json()["business_name"] == "Hilltop Roofing"

    lead_after = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead_after["status"] == "won"


def test_convert_lead_records_won_opportunity_for_dashboard(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id, "won_price_cents": 89900})

    overview = authed_client.get("/api/v1/dashboard/overview").json()
    assert overview["won_projects"] == 1
    assert overview["revenue_cents"] == 89900


def test_convert_lead_closes_an_existing_open_proposal_instead_of_duplicating_it(authed_client):
    """A lead with a logged proposal that is then won should end with one
    WON opportunity, not a stray OPEN one beside a new WON one — the
    dashboard would otherwise count the same deal as both pipeline value
    and won revenue."""
    lead_id = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"}).json()["id"]
    authed_client.post(f"/api/v1/leads/{lead_id}/opportunities", json={"tier": "Core", "proposed_price_cents": 120000})

    authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id, "won_price_cents": 120000})

    opportunities = authed_client.get(f"/api/v1/leads/{lead_id}/opportunities").json()
    assert len(opportunities) == 1
    assert opportunities[0]["status"] == "won"

    dashboard = authed_client.get("/api/v1/dashboard/sales").json()
    assert dashboard["estimated_revenue_cents"] == 0  # nothing still open
    assert dashboard["actual_revenue_cents"] == 120000


def test_convert_lead_without_price_still_counts_as_won(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id})

    overview = authed_client.get("/api/v1/dashboard/overview").json()
    assert overview["won_projects"] == 1
    assert overview["revenue_cents"] == 0


def test_convert_unknown_lead_404s(authed_client):
    res = authed_client.post(
        "/api/v1/clients", json={"from_lead_id": "00000000-0000-0000-0000-000000000000"}
    )
    assert res.status_code == 404


def test_get_client_not_found(authed_client):
    res = authed_client.get("/api/v1/clients/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404


def test_convert_lead_creates_project_with_agreed_terms(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    client_res = authed_client.post(
        "/api/v1/clients",
        json={
            "from_lead_id": lead_id,
            "won_price_cents": 89900,
            "package": "Core",
            "deadline": "2026-10-01",
            "project_name": "Hilltop Roofing Rebuild",
        },
    )
    assert client_res.status_code == 201
    client_body = client_res.json()
    assert client_body["project_count"] == 1

    projects = authed_client.get("/api/v1/projects").json()
    assert len(projects) == 1
    project = projects[0]
    assert project["client_id"] == client_body["id"]
    assert project["source_lead_id"] == lead_id
    assert project["name"] == "Hilltop Roofing Rebuild"
    assert project["stage"] == "intake"
    assert project["package"] == "Core"
    assert project["price_cents"] == 89900
    assert project["deadline"] == "2026-10-01"


def test_convert_lead_creates_default_intake_tasks(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id})

    project = authed_client.get("/api/v1/projects").json()[0]
    tasks = authed_client.get("/api/v1/tasks").json()
    project_tasks = [t for t in tasks if t["project_id"] == project["id"]]
    assert len(project_tasks) == 3
    assert all(not t["done"] for t in project_tasks)


def test_convert_lead_project_defaults_name_from_business(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id})

    project = authed_client.get("/api/v1/projects").json()[0]
    assert project["name"] == "Hilltop Roofing Website"


def test_convert_same_lead_twice_is_rejected(authed_client):
    lead_res = authed_client.post("/api/v1/leads", json={"business_name": "Hilltop Roofing"})
    lead_id = lead_res.json()["id"]

    first = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id})
    assert first.status_code == 201

    second = authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id})
    assert second.status_code == 409

    # Only one project/client pair was created — the rejected attempt
    # didn't leave a partial second project behind.
    assert len(authed_client.get("/api/v1/projects").json()) == 1
    assert len(authed_client.get("/api/v1/clients").json()) == 1


def test_convert_lead_preserves_original_lead_and_its_history(authed_client, db_session):
    lead_res = authed_client.post(
        "/api/v1/leads",
        json={
            "business_name": "Hilltop Roofing",
            "source": "referral",
            "industry": "Roofing",
            "website_url": "https://hilltoproofing.example",
            "phone": "0400 000 000",
            "suburb": "Byron Bay",
            "state": "NSW",
        },
    )
    lead_id = lead_res.json()["id"]
    business_id = lead_res.json()["business_id"]
    authed_client.patch(f"/api/v1/leads/{lead_id}", json={"notes": "Met at trade show"})
    authed_client.patch(f"/api/v1/businesses/{business_id}", json={"notes": "Family-owned, 20 years in business"})

    db_session.add(Interaction(lead_id=lead_id, kind=InteractionKind.OUTREACH_SENT, summary="Sent first email"))
    db_session.add(WebsiteAudit(lead_id=lead_id, has_existing_site=False))
    db_session.add(Contact(business_id=business_id, name="Jamie Roof", email="jamie@hilltoproofing.example"))
    db_session.add(
        SalesAuditReport(
            lead_id=lead_id,
            business_summary="Local roofing business established 20 years ago.",
            website_strengths="Clear phone number in header.",
            top_problems="No mobile-friendly layout.",
            why_problems_matter="Most local searches happen on mobile.",
            recommended_improvements="Add a responsive layout.",
            suggested_structure="Home, Services, Contact.",
            talking_points="Their site loses mobile visitors today.",
            potential_objections="Budget concerns.",
            suggested_offer="Core package.",
            model_used="test-model",
            prompt_version="v1",
        )
    )
    db_session.add(
        OutreachMessage(
            lead_id=lead_id,
            channel=OutreachChannel.EMAIL,
            subject="Quick thought on your website",
            body="Hi Jamie, ...",
            model_used="test-model",
            prompt_version="v1",
        )
    )
    db_session.commit()

    authed_client.post("/api/v1/clients", json={"from_lead_id": lead_id, "won_price_cents": 89900})

    # The original lead record still exists, untouched beyond status, and
    # is still directly reachable — nothing about the conversion deletes
    # or overwrites it.
    lead_after = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead_after["status"] == "won"
    assert lead_after["source"] == "referral"
    assert lead_after["notes"] == "Met at trade show"

    project = authed_client.get("/api/v1/projects").json()[0]
    assert project["source_lead_id"] == lead_id

    # Business info, contact info, website research, and sales history all
    # remain reachable — the shared Business row (now also the Client's
    # business) and the untouched Lead row are the source of truth for
    # both, never copied onto the new Client/Project.
    client_after = authed_client.get(f"/api/v1/clients/{project['client_id']}").json()
    assert client_after["business_id"] == business_id
    business_after = authed_client.get(f"/api/v1/businesses/{business_id}").json()
    assert business_after["industry"] == "Roofing"
    assert business_after["phone"] == "0400 000 000"
    assert business_after["notes"] == "Family-owned, 20 years in business"

    interactions = db_session.query(Interaction).filter(Interaction.lead_id == lead_id).all()
    assert len(interactions) == 1
    audits = db_session.query(WebsiteAudit).filter(WebsiteAudit.lead_id == lead_id).all()
    assert len(audits) == 1
    contacts = db_session.query(Contact).filter(Contact.business_id == business_id).all()
    assert len(contacts) == 1
    assert contacts[0].email == "jamie@hilltoproofing.example"
    sales_audits = db_session.query(SalesAuditReport).filter(SalesAuditReport.lead_id == lead_id).all()
    assert len(sales_audits) == 1
    outreach = db_session.query(OutreachMessage).filter(OutreachMessage.lead_id == lead_id).all()
    assert len(outreach) == 1


def test_update_client_billing_and_contract_fields(authed_client):
    client_row = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"}).json()

    res = authed_client.patch(
        f"/api/v1/clients/{client_row['id']}",
        json={"billing_email": "billing@coastalcafe.example", "contract_signed_at": "2026-08-18T00:00:00Z"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["billing_email"] == "billing@coastalcafe.example"
    assert body["contract_signed_at"] is not None


def test_update_client_clears_billing_email(authed_client):
    client_row = authed_client.post(
        "/api/v1/clients", json={"business_name": "Coastal Cafe", "billing_email": "old@example.com"}
    ).json()

    res = authed_client.patch(f"/api/v1/clients/{client_row['id']}", json={"billing_email": None})
    assert res.status_code == 200
    assert res.json()["billing_email"] is None


def test_update_client_omitted_fields_untouched(authed_client):
    client_row = authed_client.post(
        "/api/v1/clients", json={"business_name": "Coastal Cafe", "billing_email": "keep@example.com"}
    ).json()

    res = authed_client.patch(f"/api/v1/clients/{client_row['id']}", json={})
    assert res.status_code == 200
    assert res.json()["billing_email"] == "keep@example.com"
