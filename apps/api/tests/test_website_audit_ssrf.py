import asyncio

import pytest

from app.integrations.browser import fetch_page_signals
from tests.test_sales_audits import FAKE_LLM_OUTPUT


@pytest.mark.parametrize(
    "url,expected_error_fragment",
    [
        ("http://127.0.0.1/", "non-public address"),
        ("http://169.254.169.254/latest/meta-data/", "non-public address"),  # cloud metadata endpoint
        ("http://10.0.0.5/", "non-public address"),
        ("http://192.168.1.1/", "non-public address"),
        ("http://[::1]/", "non-public address"),
        ("http://localhost:8000", "not an allowed audit target"),
        ("ftp://example.com", "Unsupported URL scheme"),
        ("not-a-url", "Unsupported URL scheme"),
    ],
)
def test_fetch_page_signals_rejects_unsafe_targets(url, expected_error_fragment):
    result = asyncio.run(fetch_page_signals(url))
    assert result.error is not None
    assert expected_error_fragment in result.error
    # Nothing else should be populated when the fetch was refused outright.
    assert result.https is None
    assert result.load_time_ms is None


def test_generate_sales_audit_blocks_private_ip_website(authed_client, monkeypatch):
    monkeypatch.setattr("app.agents.sales_audit.generate_structured", lambda **kwargs: dict(FAKE_LLM_OUTPUT))
    monkeypatch.setattr("app.integrations.search.search_business", lambda query: None)

    lead = authed_client.post("/api/v1/leads", json={"business_name": "Test Co"}).json()
    authed_client.patch(
        f"/api/v1/businesses/{lead['business_id']}",
        json={"website_url": "http://169.254.169.254/latest/meta-data/"},
    )

    res = authed_client.post(f"/api/v1/leads/{lead['id']}/sales-audits")
    assert res.status_code == 201
    body = res.json()
    assert body["website_audit"]["audit_error"] is not None
    assert "non-public address" in body["website_audit"]["audit_error"]
    assert body["flagged_for_review"] is True
