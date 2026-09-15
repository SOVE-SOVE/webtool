from datetime import date, timedelta

from app.jobs.handlers import handle_hosting_billing_sweep
from app.modules.billing import service as billing_service
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import JOB_HOSTING_BILLING_SWEEP

TODAY = date.today()


def _iso(d: date) -> str:
    return d.isoformat()


def _make_project(authed_client, name="Coastal Cafe Website"):
    client_res = authed_client.post("/api/v1/clients", json={"business_name": "Coastal Cafe"})
    client_id = client_res.json()["id"]
    project_res = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": name})
    return client_id, project_res.json()["id"]


def _run_sweep(db_session, workspace_id) -> dict:
    """Enqueue-and-run the sweep once."""
    jobs_service.enqueue(db_session, workspace_id=workspace_id, job_type=JOB_HOSTING_BILLING_SWEEP, payload={})
    job = jobs_service.claim_next(db_session)
    assert job is not None
    result = handle_hosting_billing_sweep(db_session, job)
    jobs_service.mark_done(db_session, job, result)
    return result


# ---------------------------------------------------------------------------
# Website agreements
# ---------------------------------------------------------------------------


def test_agreement_unconfigured_vs_zero_price(authed_client):
    _, project_id = _make_project(authed_client)

    unset = authed_client.get(f"/api/v1/billing/projects/{project_id}/agreement")
    assert unset.status_code == 200
    assert unset.json() is None

    res = authed_client.put(f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": None})
    assert res.status_code == 200
    assert res.json()["price_cents"] is None

    summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert summary["status"] == "unconfigured"

    res = authed_client.put(f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 0})
    assert res.status_code == 200
    assert res.json()["price_cents"] == 0

    summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert summary["status"] == "paid"  # zero-price agreement, nothing owed


def test_deposit_cannot_exceed_price(authed_client):
    _, project_id = _make_project(authed_client)
    res = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 10000, "deposit_required_cents": 20000},
    )
    assert res.status_code == 422


def test_agreement_mirrors_onto_legacy_project_price_cents(authed_client):
    _, project_id = _make_project(authed_client)
    authed_client.put(f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 150000})
    project = authed_client.get(f"/api/v1/projects/{project_id}").json()
    assert project["price_cents"] == 150000


# ---------------------------------------------------------------------------
# Payments — partial, multiple, deposit-as-part-of-total, duplicates
# ---------------------------------------------------------------------------


def test_partial_and_multiple_payments_reduce_balance(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 100000, "deposit_required_cents": 30000},
    ).json()

    def pay(amount, received_date):
        return authed_client.post(
            "/api/v1/billing/payments",
            json={
                "project_id": project_id,
                "allocation": {"type": "agreement", "id": agreement["id"]},
                "amount_cents": amount,
                "received_date": received_date,
            },
        )

    r1 = pay(30000, _iso(TODAY))
    assert r1.status_code == 201
    summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert summary["paid_cents"] == 30000
    assert summary["outstanding_cents"] == 70000
    assert summary["status"] == "partially_paid"

    pay(70000, _iso(TODAY))
    summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert summary["paid_cents"] == 100000
    assert summary["outstanding_cents"] == 0
    assert summary["status"] == "paid"


def test_duplicate_payment_submission_returns_existing_row(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 50000}
    ).json()
    payload = {
        "project_id": project_id,
        "allocation": {"type": "agreement", "id": agreement["id"]},
        "amount_cents": 50000,
        "received_date": _iso(TODAY),
    }
    first = authed_client.post("/api/v1/billing/payments", json=payload)
    second = authed_client.post("/api/v1/billing/payments", json=payload)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert summary["paid_cents"] == 50000  # not 100000 — the resubmit didn't double-count


def test_overpayment_is_explicit_not_negative(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 10000}
    ).json()
    authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 15000,
            "received_date": _iso(TODAY),
        },
    )
    summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert summary["outstanding_cents"] == 0  # clamped, never negative
    assert summary["status"] == "overpaid"
    assert summary["paid_cents"] == 15000


# ---------------------------------------------------------------------------
# Refunds / corrections — audit trail
# ---------------------------------------------------------------------------


def test_refund_reduces_net_but_keeps_payment_visible(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 100000}
    ).json()
    payment = authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 100000,
            "received_date": _iso(TODAY),
        },
    ).json()

    refund = authed_client.patch(
        f"/api/v1/billing/payments/{payment['id']}/refund",
        json={"refund_amount_cents": 20000, "reason": "Client requested partial refund"},
    )
    assert refund.status_code == 200
    assert refund.json()["net_cents"] == 80000
    assert refund.json()["refunded_cents"] == 20000

    summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert summary["paid_cents"] == 80000
    assert summary["outstanding_cents"] == 20000

    # still visible in the client's payment history
    client_id = authed_client.get(f"/api/v1/projects/{project_id}").json()["client_id"]
    billing = authed_client.get(f"/api/v1/billing/clients/{client_id}/summary").json()
    assert len(billing["payments"]) == 1
    assert billing["payments"][0]["refunded_cents"] == 20000


def test_refund_cannot_exceed_payment_amount(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 50000}
    ).json()
    payment = authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 50000,
            "received_date": _iso(TODAY),
        },
    ).json()
    res = authed_client.patch(
        f"/api/v1/billing/payments/{payment['id']}/refund",
        json={"refund_amount_cents": 60000, "reason": "too much"},
    )
    assert res.status_code == 422


def test_void_excludes_from_totals_but_persists(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 50000}
    ).json()
    payment = authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 50000,
            "received_date": _iso(TODAY),
        },
    ).json()

    void = authed_client.patch(
        f"/api/v1/billing/payments/{payment['id']}/void", json={"reason": "Entered in error"}
    )
    assert void.status_code == 200
    assert void.json()["net_cents"] == 0

    summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert summary["paid_cents"] == 0
    assert summary["status"] == "unpaid"

    client_id = authed_client.get(f"/api/v1/projects/{project_id}").json()["client_id"]
    billing = authed_client.get(f"/api/v1/billing/clients/{client_id}/summary").json()
    assert len(billing["payments"]) == 1  # never deleted
    assert billing["payments"][0]["voided_at"] is not None


# ---------------------------------------------------------------------------
# Hosting plans — creation, pause/cancel/resume, fee changes
# ---------------------------------------------------------------------------


def test_hosting_plan_first_due_date_not_before_start_date(authed_client):
    _, project_id = _make_project(authed_client)
    res = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": "2026-06-10", "billing_day": 15},
    )
    assert res.status_code == 201
    assert res.json()["next_due_date"] == "2026-06-15"


def test_hosting_plan_month_end_clamping(authed_client):
    # billing_day 31 starting in a 30-day month: first due date clamps to
    # the last day of *that* month, not overflowing into the next one.
    res = authed_client.post(
        f"/api/v1/billing/projects/{_make_project(authed_client)[1]}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": "2026-04-01", "billing_day": 31},
    ).json()
    assert res["next_due_date"] == "2026-04-30"

    # advance_one_month across Feb (non-leap 2026) and Apr (30 days)
    assert billing_service.advance_one_month(date(2026, 1, 31), 31) == date(2026, 2, 28)
    assert billing_service.advance_one_month(date(2026, 2, 28), 31) == date(2026, 3, 31)
    assert billing_service.advance_one_month(date(2026, 3, 31), 31) == date(2026, 4, 30)


def test_pause_freezes_next_due_date_and_resume_does_not_backlog(authed_client, db_session, workspace):
    _, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    assert plan["next_due_date"] == _iso(TODAY)

    authed_client.patch(
        f"/api/v1/billing/hosting-plans/{plan['id']}/pause", json={"effective_date": _iso(TODAY)}
    )

    # Sweep runs while paused: no charge is generated, next_due_date untouched.
    result = _run_sweep(db_session, workspace.id)
    assert result["generated"] == 0
    plans_after = authed_client.get(f"/api/v1/billing/projects/{project_id}/hosting-plans").json()
    assert plans_after[0]["status"] == "paused"
    assert plans_after[0]["next_due_date"] == _iso(TODAY)

    future = TODAY + timedelta(days=60)
    resumed = authed_client.patch(
        f"/api/v1/billing/hosting-plans/{plan['id']}/resume", json={"effective_date": _iso(future)}
    ).json()
    assert resumed["next_due_date"] == _iso(future)  # no backlog for the paused period


def test_cancel_does_not_erase_unpaid_charges_or_past_payments(authed_client, db_session, workspace):
    _, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    result = _run_sweep(db_session, workspace.id)
    assert result["generated"] == 1

    balances_before = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY - timedelta(days=1))}&end={_iso(TODAY + timedelta(days=1))}"
    ).json()
    assert balances_before["outstanding_balance_cents"] == 5000

    authed_client.patch(
        f"/api/v1/billing/hosting-plans/{plan['id']}/cancel",
        json={"effective_date": _iso(TODAY), "reason": "client left"},
    )
    plans_after = authed_client.get(f"/api/v1/billing/projects/{project_id}/hosting-plans").json()
    assert plans_after[0]["status"] == "cancelled"

    # unpaid balance from before cancellation is still there
    balances_after = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY - timedelta(days=1))}&end={_iso(TODAY + timedelta(days=1))}"
    ).json()
    assert balances_after["outstanding_balance_cents"] == 5000


def test_fee_change_does_not_rewrite_past_charge_amounts(authed_client, db_session, workspace):
    _, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    _run_sweep(db_session, workspace.id)  # generates one charge at $50.00

    from app.modules.billing.models import HostingCharge

    charge_before = db_session.query(HostingCharge).filter_by(hosting_plan_id=plan["id"]).first()
    assert charge_before.amount_cents == 5000

    authed_client.patch(
        f"/api/v1/billing/hosting-plans/{plan['id']}/fee",
        json={"new_monthly_fee_cents": 8000, "effective_date": _iso(TODAY + timedelta(days=30))},
    )

    db_session.expire_all()
    charge_after = db_session.query(HostingCharge).filter_by(hosting_plan_id=plan["id"]).first()
    assert charge_after.amount_cents == 5000  # past charge untouched by the fee change

    updated_plan = authed_client.get(f"/api/v1/billing/projects/{project_id}/hosting-plans").json()[0]
    assert updated_plan["monthly_fee_cents"] == 8000  # future charges will use the new fee


# ---------------------------------------------------------------------------
# Sweep job — idempotency, MRR exclusion
# ---------------------------------------------------------------------------


def test_sweep_never_duplicates_a_charge_for_the_same_period(authed_client, db_session, workspace):
    from app.modules.billing.models import HostingCharge, HostingPlan

    _, project_id = _make_project(authed_client)
    authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    )
    result1 = _run_sweep(db_session, workspace.id)
    assert result1["generated"] == 1

    result2 = _run_sweep(db_session, workspace.id)
    assert result2["generated"] == 0  # already generated for that period

    plan = db_session.query(HostingPlan).filter_by(project_id=project_id).first()
    charges = list(db_session.query(HostingCharge).filter_by(hosting_plan_id=plan.id))
    assert len(charges) == 1


def test_mrr_excludes_paused_and_cancelled_plans(authed_client):
    _, project_id_a = _make_project(authed_client, "Active Site")
    _, project_id_b = _make_project(authed_client, "Paused Site")

    authed_client.post(
        f"/api/v1/billing/projects/{project_id_a}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": "2026-01-01", "billing_day": 1},
    )
    plan_b = authed_client.post(
        f"/api/v1/billing/projects/{project_id_b}/hosting-plans",
        json={"monthly_fee_cents": 7000, "start_date": "2026-01-01", "billing_day": 1},
    ).json()
    authed_client.patch(
        f"/api/v1/billing/hosting-plans/{plan_b['id']}/pause", json={"effective_date": "2026-01-01"}
    )

    report = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY)}&end={_iso(TODAY)}"
    ).json()
    assert report["expected_mrr_cents"] == 5000  # only the active plan


# ---------------------------------------------------------------------------
# Reporting — receipt-date based, overdue boundary, no double counting
# ---------------------------------------------------------------------------


def test_payments_received_uses_received_date_not_created_at(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 50000}
    ).json()
    in_range_date = TODAY - timedelta(days=10)
    authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 50000,
            "received_date": _iso(in_range_date),
        },
    )
    in_range_report = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(in_range_date)}&end={_iso(in_range_date)}"
    ).json()
    assert in_range_report["website_payments_received_cents"] == 50000

    out_of_range_report = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY)}&end={_iso(TODAY)}"
    ).json()
    assert out_of_range_report["website_payments_received_cents"] == 0


def test_overdue_vs_not_yet_due_boundary(authed_client, db_session, workspace):
    today = billing_service.today_in_workspace(db_session, workspace.id)
    _, project_id = _make_project(authed_client)

    authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 10000, "due_date": _iso(today - timedelta(days=1))},
    )

    balances = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(today - timedelta(days=365))}&end={_iso(today + timedelta(days=365))}"
    ).json()
    assert balances["overdue_count"] == 1
    assert balances["overdue_cents"] == 10000

    # a second project due today (not yet overdue by this definition)
    _, project_id_2 = _make_project(authed_client, "Not Due Yet")
    authed_client.put(
        f"/api/v1/billing/projects/{project_id_2}/agreement",
        json={"price_cents": 20000, "due_date": _iso(today)},
    )
    balances_after = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(today - timedelta(days=365))}&end={_iso(today + timedelta(days=365))}"
    ).json()
    assert balances_after["overdue_count"] == 1  # still just the one from before
    assert balances_after["outstanding_balance_cents"] == 30000  # both count as outstanding though


def test_website_and_hosting_payments_reported_separately(authed_client, db_session, workspace):
    from app.modules.billing.models import HostingCharge

    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 50000}
    ).json()
    authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 50000,
            "received_date": _iso(TODAY),
        },
    )
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    _run_sweep(db_session, workspace.id)
    charge = db_session.query(HostingCharge).filter_by(hosting_plan_id=plan["id"]).first()
    authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "hosting_charge", "id": str(charge.id)},
            "amount_cents": 5000,
            "received_date": _iso(TODAY),
        },
    )

    report = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY)}&end={_iso(TODAY)}"
    ).json()
    assert report["website_payments_received_cents"] == 50000
    assert report["hosting_payments_received_cents"] == 5000
    assert report["total_payments_received_cents"] == 55000


# ---------------------------------------------------------------------------
# Workspace isolation
# ---------------------------------------------------------------------------


def test_workspace_isolation(authed_client, other_authed_client):
    _, project_id = _make_project(authed_client)
    authed_client.put(f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 50000})

    # Not found in the other workspace at all — the agreement lookup is
    # workspace-scoped and simply returns "no agreement" (200/null),
    # identical to what any project with no agreement yet would return,
    # so nothing about the first workspace's data leaks either way.
    other_get = other_authed_client.get(f"/api/v1/billing/projects/{project_id}/agreement")
    assert other_get.status_code == 200
    assert other_get.json() is None

    other_summary = other_authed_client.get(f"/api/v1/billing/projects/{project_id}/summary")
    assert other_summary.status_code == 404

    other_report = other_authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY)}&end={_iso(TODAY)}"
    ).json()
    assert other_report["outstanding_balance_cents"] == 0


# ---------------------------------------------------------------------------
# End-to-end: agreement -> deposit -> final payment -> hosting charge ->
# hosting payment -> Revenue/Today totals.
# ---------------------------------------------------------------------------


def test_end_to_end_website_and_hosting_flow(authed_client, db_session, workspace):
    _, project_id = _make_project(authed_client, "Full Flow Website")

    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 200000, "deposit_required_cents": 50000, "due_date": _iso(TODAY + timedelta(days=14))},
    ).json()

    deposit = authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 50000,
            "received_date": _iso(TODAY),
            "method": "bank transfer",
        },
    )
    assert deposit.status_code == 201

    mid_summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert mid_summary["status"] == "partially_paid"
    assert mid_summary["outstanding_cents"] == 150000

    final_payment = authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 150000,
            "received_date": _iso(TODAY),
            "method": "bank transfer",
        },
    )
    assert final_payment.status_code == 201

    final_summary = authed_client.get(f"/api/v1/billing/projects/{project_id}/summary").json()
    assert final_summary["status"] == "paid"
    assert final_summary["outstanding_cents"] == 0

    hosting_plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    assert hosting_plan["next_due_date"] == _iso(TODAY)

    sweep_result = _run_sweep(db_session, workspace.id)
    assert sweep_result["generated"] == 1

    from app.modules.billing.models import HostingCharge

    charge = db_session.query(HostingCharge).filter_by(hosting_plan_id=hosting_plan["id"]).first()
    assert charge is not None
    assert charge.amount_cents == 4900

    hosting_payment = authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "hosting_charge", "id": str(charge.id)},
            "amount_cents": 4900,
            "received_date": _iso(TODAY),
        },
    )
    assert hosting_payment.status_code == 201

    revenue = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY)}&end={_iso(TODAY)}"
    ).json()
    assert revenue["website_payments_received_cents"] == 200000
    assert revenue["hosting_payments_received_cents"] == 4900
    assert revenue["total_payments_received_cents"] == 204900
    assert revenue["expected_mrr_cents"] == 4900
    assert revenue["outstanding_balance_cents"] == 0

    today_snapshot = authed_client.get("/api/v1/billing/reports/today").json()
    assert today_snapshot["overdue_client_count"] == 0
    assert today_snapshot["expected_mrr_cents"] == 4900
    # The plan's next (not-yet-generated) hosting charge shows as a
    # scheduled upcoming obligation — everything else here is paid off.
    assert len(today_snapshot["upcoming_payments"]) == 1
    assert today_snapshot["upcoming_payments"][0]["scheduled"] is True


# ---------------------------------------------------------------------------
# Next payment due — earliest unpaid obligation across a client's projects
# ---------------------------------------------------------------------------


def test_next_payment_upcoming_agreement_balance(authed_client):
    client_id, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 100000, "due_date": _iso(TODAY + timedelta(days=7))},
    ).json()

    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert summary["overdue"] == []
    assert len(summary["upcoming"]) == 1
    ob = summary["upcoming"][0]
    assert ob["kind"] == "website_balance"
    assert ob["amount_cents"] == 100000
    assert ob["due_date"] == _iso(TODAY + timedelta(days=7))
    assert ob["days_relative"] == 7
    assert ob["is_overdue"] is False
    assert ob["website_agreement_id"] == agreement["id"]
    assert summary["no_due_date_count"] == 0


def test_next_payment_deposit_vs_balance(authed_client):
    client_id, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 100000, "deposit_required_cents": 30000, "due_date": _iso(TODAY)},
    ).json()

    # Nothing paid yet — outstanding obligation is the deposit, and its
    # amount is the deposit itself, not the full project balance.
    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert summary["upcoming"][0]["kind"] == "website_deposit"
    assert summary["upcoming"][0]["amount_cents"] == 30000
    assert summary["upcoming"][0]["days_relative"] == 0  # due today

    # Pay the deposit — remaining obligation becomes the balance.
    authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 30000,
            "received_date": _iso(TODAY),
        },
    )
    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert summary["upcoming"][0]["kind"] == "website_balance"
    assert summary["upcoming"][0]["amount_cents"] == 70000


def test_next_payment_deposit_amount_is_remaining_deposit_not_full_balance(authed_client):
    client_id, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 100000, "deposit_required_cents": 30000, "due_date": _iso(TODAY)},
    ).json()

    # A partial payment toward the deposit — the obligation should show
    # what's still owed on the deposit (20000), not the whole remaining
    # project balance (90000).
    authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 10000,
            "received_date": _iso(TODAY),
        },
    )
    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert summary["upcoming"][0]["kind"] == "website_deposit"
    assert summary["upcoming"][0]["amount_cents"] == 20000


def test_next_payment_overdue_shown_separately_from_upcoming(authed_client):
    client_id, project_id_a = _make_project(authed_client, "Overdue Project")
    project_b = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Future Project"}
    ).json()

    authed_client.put(
        f"/api/v1/billing/projects/{project_id_a}/agreement",
        json={"price_cents": 50000, "due_date": _iso(TODAY - timedelta(days=3))},
    )
    authed_client.put(
        f"/api/v1/billing/projects/{project_b['id']}/agreement",
        json={"price_cents": 20000, "due_date": _iso(TODAY + timedelta(days=5))},
    )

    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert len(summary["overdue"]) == 1
    assert summary["overdue"][0]["amount_cents"] == 50000
    assert summary["overdue"][0]["days_relative"] == -3
    assert summary["overdue"][0]["is_overdue"] is True
    assert len(summary["upcoming"]) == 1
    assert summary["upcoming"][0]["amount_cents"] == 20000


def test_next_payment_multiple_due_same_date(authed_client):
    client_id, project_id_a = _make_project(authed_client, "Project A")
    project_b = authed_client.post(
        "/api/v1/projects", json={"client_id": client_id, "name": "Project B"}
    ).json()
    same_date = _iso(TODAY + timedelta(days=10))
    authed_client.put(f"/api/v1/billing/projects/{project_id_a}/agreement", json={"price_cents": 10000, "due_date": same_date})
    authed_client.put(f"/api/v1/billing/projects/{project_b['id']}/agreement", json={"price_cents": 20000, "due_date": same_date})

    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert len(summary["upcoming"]) == 2
    assert {o["amount_cents"] for o in summary["upcoming"]} == {10000, 20000}


def test_next_payment_no_due_date_set(authed_client):
    client_id, project_id = _make_project(authed_client)
    authed_client.put(f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 50000})

    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert summary["overdue"] == []
    assert summary["upcoming"] == []
    assert summary["no_due_date_count"] == 1
    assert summary["no_due_date_cents"] == 50000


def test_next_payment_nothing_scheduled(authed_client):
    client_id, project_id = _make_project(authed_client)
    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert summary["overdue"] == []
    assert summary["upcoming"] == []
    assert summary["no_due_date_count"] == 0
    assert summary["no_due_date_cents"] == 0


def test_next_payment_hosting_scheduled_not_yet_generated(authed_client):
    client_id, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY + timedelta(days=20)), "billing_day": (TODAY + timedelta(days=20)).day},
    ).json()

    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert len(summary["upcoming"]) == 1
    ob = summary["upcoming"][0]
    assert ob["kind"] == "hosting_scheduled"
    assert ob["scheduled"] is True
    assert ob["amount_cents"] == 4900
    assert ob["hosting_plan_id"] == plan["id"]
    assert ob["hosting_charge_id"] is None


def test_next_payment_generated_charge_replaces_scheduled_projection(authed_client, db_session, workspace):
    client_id, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    _run_sweep(db_session, workspace.id)  # generates the due charge, advances next_due_date

    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    # Exactly one obligation for this plan — the real generated charge,
    # not also a "scheduled" projection for the same period.
    plan_obligations = [o for o in summary["upcoming"] + summary["overdue"] if o["hosting_plan_id"] == plan["id"]]
    assert len(plan_obligations) == 1
    assert plan_obligations[0]["kind"] == "hosting_charge"
    assert plan_obligations[0]["scheduled"] is False
    assert plan_obligations[0]["hosting_charge_id"] is not None


def test_next_payment_paused_plan_keeps_existing_charge_but_no_new_projection(authed_client, db_session, workspace):
    client_id, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    _run_sweep(db_session, workspace.id)  # one real unpaid charge exists now

    authed_client.patch(f"/api/v1/billing/hosting-plans/{plan['id']}/pause", json={"effective_date": _iso(TODAY)})

    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    plan_obligations = [o for o in summary["upcoming"] + summary["overdue"] if o["hosting_plan_id"] == plan["id"]]
    # The already-generated charge is still visible...
    assert len(plan_obligations) == 1
    assert plan_obligations[0]["scheduled"] is False
    # ...and pausing produced no second, projected obligation.
    assert not any(o["scheduled"] for o in plan_obligations)


def test_next_payment_cancelled_plan_no_projection(authed_client):
    client_id, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY + timedelta(days=30)), "billing_day": 1},
    ).json()
    authed_client.patch(f"/api/v1/billing/hosting-plans/{plan['id']}/cancel", json={"effective_date": _iso(TODAY)})

    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    plan_obligations = [o for o in summary["upcoming"] + summary["overdue"] if o["hosting_plan_id"] == plan["id"]]
    assert plan_obligations == []


def test_next_payment_updates_after_recording_payment(authed_client):
    client_id, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 50000, "due_date": _iso(TODAY)},
    ).json()
    assert len(authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()["upcoming"]) == 1

    authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 50000,
            "received_date": _iso(TODAY),
        },
    )
    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    assert summary["upcoming"] == []
    assert summary["overdue"] == []
    assert summary["no_due_date_count"] == 0


# ---------------------------------------------------------------------------
# Hosting charge due-date editor
# ---------------------------------------------------------------------------


def test_update_hosting_charge_due_date(authed_client, db_session, workspace):
    client_id, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    _run_sweep(db_session, workspace.id)
    charge = authed_client.get(f"/api/v1/billing/hosting-plans/{plan['id']}/charges").json()[0]

    new_due = _iso(TODAY + timedelta(days=14))
    res = authed_client.patch(f"/api/v1/billing/hosting-charges/{charge['id']}/due-date", json={"due_date": new_due})
    assert res.status_code == 200
    assert res.json()["due_date"] == new_due

    # Reflected in the next-payment summary too.
    summary = authed_client.get(f"/api/v1/billing/clients/{client_id}/next-payment").json()
    ob = next(o for o in summary["upcoming"] if o["hosting_charge_id"] == charge["id"])
    assert ob["due_date"] == new_due


# ---------------------------------------------------------------------------
# Revenue page — workspace-wide obligations
# ---------------------------------------------------------------------------


def test_workspace_obligations_spans_multiple_clients(authed_client):
    client_a, project_a = _make_project(authed_client, "Project A")
    client_b, project_b = _make_project(authed_client, "Project B")
    authed_client.put(
        f"/api/v1/billing/projects/{project_a}/agreement",
        json={"price_cents": 10000, "due_date": _iso(TODAY - timedelta(days=3))},
    )
    authed_client.put(
        f"/api/v1/billing/projects/{project_b}/agreement",
        json={"price_cents": 20000, "due_date": _iso(TODAY + timedelta(days=5))},
    )

    obligations = authed_client.get("/api/v1/billing/reports/obligations").json()
    by_project = {o["project_id"]: o for o in obligations}
    assert by_project[project_a]["client_id"] == client_a
    assert by_project[project_a]["is_overdue"] is True
    assert by_project[project_b]["client_id"] == client_b
    assert by_project[project_b]["is_overdue"] is False


def test_workspace_obligations_scheduled_hosting_not_double_counted(authed_client, db_session, workspace):
    client_id, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()

    # Before the sweep runs, it's a "scheduled" projection.
    obligations = authed_client.get("/api/v1/billing/reports/obligations").json()
    plan_obs = [o for o in obligations if o["hosting_plan_id"] == plan["id"]]
    assert len(plan_obs) == 1
    assert plan_obs[0]["scheduled"] is True
    assert plan_obs[0]["client_business_name"] is not None

    # After the sweep generates the real charge (and advances the plan's
    # next_due_date to the following period), the real charge replaces
    # the projection for *that* period — a new scheduled projection for
    # the now-current next_due_date is a separate, later obligation, not
    # a duplicate of the same one.
    _run_sweep(db_session, workspace.id)
    obligations = authed_client.get("/api/v1/billing/reports/obligations").json()
    plan_obs = [o for o in obligations if o["hosting_plan_id"] == plan["id"]]
    due_dates = [o["due_date"] for o in plan_obs]
    assert len(due_dates) == len(set(due_dates))  # no two obligations share the same due date
    generated = next(o for o in plan_obs if o["scheduled"] is False)
    assert generated["hosting_charge_id"] is not None
    assert any(o["scheduled"] is True for o in plan_obs)  # the next period's projection


def test_workspace_obligations_paused_plan_keeps_charge_no_new_projection(authed_client, db_session, workspace):
    _, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    _run_sweep(db_session, workspace.id)
    authed_client.patch(f"/api/v1/billing/hosting-plans/{plan['id']}/pause", json={"effective_date": _iso(TODAY)})

    obligations = authed_client.get("/api/v1/billing/reports/obligations").json()
    plan_obs = [o for o in obligations if o["hosting_plan_id"] == plan["id"]]
    assert len(plan_obs) == 1
    assert plan_obs[0]["scheduled"] is False  # the existing charge, not a new projection


# ---------------------------------------------------------------------------
# Revenue page — workspace-wide hosting plans
# ---------------------------------------------------------------------------


def test_list_all_hosting_plans_includes_client_and_outstanding(authed_client, db_session, workspace):
    client_id, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    _run_sweep(db_session, workspace.id)

    plans = authed_client.get("/api/v1/billing/hosting-plans").json()
    row = next(p for p in plans if p["id"] == plan["id"])
    assert row["client_id"] == client_id
    assert row["client_business_name"] == "Coastal Cafe"
    assert row["project_name"] == "Coastal Cafe Website"
    assert row["outstanding_cents"] == 5000
    assert row["status"] == "active"


def test_list_all_hosting_plans_reflects_status_filter_inputs(authed_client):
    _, project_id = _make_project(authed_client)
    plan = authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 5000, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    ).json()
    authed_client.patch(f"/api/v1/billing/hosting-plans/{plan['id']}/cancel", json={"effective_date": _iso(TODAY)})

    plans = authed_client.get("/api/v1/billing/hosting-plans").json()
    row = next(p for p in plans if p["id"] == plan["id"])
    assert row["status"] == "cancelled"
    assert row["outstanding_cents"] == 0  # no charge was ever generated


# ---------------------------------------------------------------------------
# Revenue page — transactions include reversals, refunds shown separately
# ---------------------------------------------------------------------------


def test_revenue_report_includes_voided_payment_as_reversal(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 50000}
    ).json()
    payment = authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 50000,
            "received_date": _iso(TODAY),
        },
    ).json()
    authed_client.patch(f"/api/v1/billing/payments/{payment['id']}/void", json={"reason": "Entered in error"})

    report = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY)}&end={_iso(TODAY)}"
    ).json()
    # Excluded from totals...
    assert report["total_payments_received_cents"] == 0
    # ...but still present in the transaction list, marked reversed.
    tx = next(t for t in report["transactions"] if t["payment_id"] == payment["id"])
    assert tx["voided"] is True
    assert tx["voided_reason"] == "Entered in error"


def test_revenue_report_shows_refunds_separately(authed_client):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 100000}
    ).json()
    payment = authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 100000,
            "received_date": _iso(TODAY),
        },
    ).json()
    authed_client.patch(
        f"/api/v1/billing/payments/{payment['id']}/refund",
        json={"refund_amount_cents": 15000, "reason": "Partial refund"},
    )

    report = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY)}&end={_iso(TODAY)}"
    ).json()
    assert report["total_payments_received_cents"] == 85000
    assert report["refunds_cents"] == 15000
    tx = next(t for t in report["transactions"] if t["payment_id"] == payment["id"])
    assert tx["refunded_cents"] == 15000
    assert tx["net_cents"] == 85000


# ---------------------------------------------------------------------------
# Today dashboard's compact revenue summary
# ---------------------------------------------------------------------------


def test_today_snapshot_counts_overdue_clients_not_overdue_rows(authed_client):
    # One client with TWO overdue charges (two projects) — should count
    # as one overdue client, not two, matching how an operator actually
    # thinks about it ("who do I need to chase").
    client_id, project_a = _make_project(authed_client, "Project A")
    project_b = authed_client.post("/api/v1/projects", json={"client_id": client_id, "name": "Project B"}).json()["id"]
    authed_client.put(
        f"/api/v1/billing/projects/{project_a}/agreement",
        json={"price_cents": 10000, "due_date": _iso(TODAY - timedelta(days=1))},
    )
    authed_client.put(
        f"/api/v1/billing/projects/{project_b}/agreement",
        json={"price_cents": 20000, "due_date": _iso(TODAY - timedelta(days=2))},
    )
    # A second, distinct client also overdue.
    client_id_2, project_c = _make_project(authed_client, "Project C")
    authed_client.put(
        f"/api/v1/billing/projects/{project_c}/agreement",
        json={"price_cents": 5000, "due_date": _iso(TODAY - timedelta(days=3))},
    )

    snapshot = authed_client.get("/api/v1/billing/reports/today").json()
    assert snapshot["overdue_client_count"] == 2
    assert snapshot["overdue_cents"] == 35000

    # Matches the Revenue report's own overdue total for the same data.
    revenue = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY)}&end={_iso(TODAY)}"
    ).json()
    assert revenue["overdue_cents"] == snapshot["overdue_cents"]


def test_today_snapshot_upcoming_payments_preview(authed_client):
    client_id, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement",
        json={"price_cents": 50000, "due_date": _iso(TODAY + timedelta(days=3))},
    ).json()

    snapshot = authed_client.get("/api/v1/billing/reports/today").json()
    assert len(snapshot["upcoming_payments"]) == 1
    ob = snapshot["upcoming_payments"][0]
    assert ob["client_id"] == client_id
    assert ob["client_business_name"] == "Coastal Cafe"
    assert ob["website_agreement_id"] == agreement["id"]
    assert ob["due_date"] == _iso(TODAY + timedelta(days=3))
    # Not counted as received — only actual Payment rows count there.
    assert snapshot["payments_received_this_month_cents"] == 0


def test_today_snapshot_reuses_revenue_payments_received_and_mrr(authed_client, db_session, workspace):
    _, project_id = _make_project(authed_client)
    agreement = authed_client.put(
        f"/api/v1/billing/projects/{project_id}/agreement", json={"price_cents": 30000}
    ).json()
    authed_client.post(
        "/api/v1/billing/payments",
        json={
            "project_id": project_id,
            "allocation": {"type": "agreement", "id": agreement["id"]},
            "amount_cents": 30000,
            "received_date": _iso(TODAY),
        },
    )
    authed_client.post(
        f"/api/v1/billing/projects/{project_id}/hosting-plans",
        json={"monthly_fee_cents": 4900, "start_date": _iso(TODAY), "billing_day": TODAY.day},
    )

    snapshot = authed_client.get("/api/v1/billing/reports/today").json()
    revenue = authed_client.get(
        f"/api/v1/billing/reports/revenue?start={_iso(TODAY.replace(day=1))}&end={_iso(TODAY)}"
    ).json()
    assert snapshot["payments_received_this_month_cents"] == revenue["total_payments_received_cents"] == 30000
    assert snapshot["expected_mrr_cents"] == revenue["expected_mrr_cents"] == 4900
