"""
T6 — lightweight AI usage observability. Covers the cost estimator, the
best-effort recorder, the router writing one event per call (both
providers, success + failure + fallback), the admin-only read API, and
the "no secrets, no prompts stored or logged" guarantee.
"""

import logging

import pytest

from app.core.settings import settings
from app.integrations.ai import router
from app.integrations.ai.errors import AIProviderError, AIProviderUnavailableError
from app.integrations.ai.providers.base import GenerationResult
from app.integrations.ai.tasks import AITask
from app.modules.ai_usage import service as usage_service
from app.modules.ai_usage.models import AiUsageEvent
from app.modules.ai_usage.pricing import estimate_cost_usd
from app.modules.ai_usage.recorder import record_ai_usage

SCHEMA = {"type": "object"}


class _FakeProvider:
    def __init__(self, *, error=None, input_tokens=None, output_tokens=None):
        self.error = error
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.calls = 0

    def generate_structured(self, system, user, schema, model, max_tokens=4096, **kwargs):
        self.calls += 1
        if self.error:
            raise self.error
        return GenerationResult(data={"ok": True}, input_tokens=self.input_tokens, output_tokens=self.output_tokens)


@pytest.fixture(autouse=True)
def _ai_settings(monkeypatch):
    monkeypatch.setattr(settings, "ai_local_provider", "ollama")
    monkeypatch.setattr(settings, "ai_local_model", "qwen3:30b-a3b")
    monkeypatch.setattr(settings, "ai_premium_provider", "anthropic")
    monkeypatch.setattr(settings, "ai_premium_model", "")
    monkeypatch.setattr(settings, "llm_model", "claude-sonnet-5")
    monkeypatch.setattr(settings, "ai_local_fallback_to_premium", False)
    monkeypatch.setattr(
        settings, "ai_anthropic_pricing_usd_per_mtok", {"claude-sonnet-5": {"input": 2.0, "output": 10.0}}
    )


# --- pricing ----------------------------------------------------------


def test_local_provider_is_zero_cost_never_a_fake_token_charge():
    assert estimate_cost_usd("ollama", "qwen3:30b-a3b", 5000, 2000) == 0.0


def test_priced_anthropic_model_cost_is_computed_from_config():
    # 1M in @ $2 + 0.5M out @ $10 = $2 + $5 = $7
    assert estimate_cost_usd("anthropic", "claude-sonnet-5", 1_000_000, 500_000) == 7.0


def test_unpriced_model_or_missing_tokens_is_unknown_not_guessed():
    assert estimate_cost_usd("anthropic", "some-unlisted-model", 1000, 1000) is None
    assert estimate_cost_usd("anthropic", "claude-sonnet-5", None, 10) is None


# --- recorder --------------------------------------------------------


def test_recorder_writes_a_row_with_the_estimated_cost(db_session):
    record_ai_usage(
        task="sales_audit", provider="anthropic", model="claude-sonnet-5", success=True,
        duration_ms=1234, input_tokens=1_000_000, output_tokens=0, retries=0,
    )
    row = db_session.query(AiUsageEvent).filter_by(task="sales_audit").one()
    assert row.provider == "anthropic"
    assert row.success is True
    assert row.cost_usd == 2.0
    assert row.duration_ms == 1234


def test_recorder_never_raises_even_if_the_db_write_fails(monkeypatch):
    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr("app.db.session.SessionLocal", boom)
    # Must not raise.
    record_ai_usage(
        task="lead_summary", provider="ollama", model="qwen3:30b-a3b", success=True, duration_ms=10
    )


# --- router integration ---------------------------------------------


def test_successful_local_call_records_a_zero_cost_ollama_event(db_session, monkeypatch):
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: _FakeProvider(
        input_tokens=900, output_tokens=100
    ))

    router.generate_structured(task=AITask.LEAD_SUMMARY, system="s", user="u", schema=SCHEMA)

    row = db_session.query(AiUsageEvent).filter_by(task="lead_summary").one()
    assert row.provider == "ollama"
    assert row.model == "qwen3:30b-a3b"
    assert row.success is True
    assert row.input_tokens == 900
    assert row.output_tokens == 100
    assert row.retries == 0
    assert row.cost_usd == 0.0


def test_successful_premium_call_records_an_anthropic_event_with_cost(db_session, monkeypatch):
    monkeypatch.setattr(router, "AnthropicProvider", lambda: _FakeProvider(input_tokens=1_000_000, output_tokens=0))

    router.generate_structured(task=AITask.CREATIVE_DIRECTION, system="s", user="u", schema=SCHEMA)

    row = db_session.query(AiUsageEvent).filter_by(task="creative_direction").one()
    assert row.provider == "anthropic"
    assert row.model == "claude-sonnet-5"
    assert row.cost_usd == 2.0


def test_failed_call_records_a_failure_event_with_an_error_category(db_session, monkeypatch):
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: _FakeProvider(
        error=AIProviderUnavailableError("couldn't reach the local AI server")
    ))

    with pytest.raises(AIProviderError):
        router.generate_structured(task=AITask.REVIEW_SUMMARY, system="s", user="u", schema=SCHEMA)

    row = db_session.query(AiUsageEvent).filter_by(task="review_summary").one()
    assert row.success is False
    assert row.error_category == "provider_unreachable"
    assert row.cost_usd is None


def test_opt_in_fallback_records_the_local_failure_then_the_premium_retry(db_session, monkeypatch):
    monkeypatch.setattr(settings, "ai_local_fallback_to_premium", True)
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: _FakeProvider(
        error=AIProviderUnavailableError("timed out")
    ))
    monkeypatch.setattr(router, "AnthropicProvider", lambda: _FakeProvider(input_tokens=10, output_tokens=10))

    router.generate_structured(task=AITask.MEETING_BRIEF, system="s", user="u", schema=SCHEMA)

    rows = db_session.query(AiUsageEvent).filter_by(task="meeting_brief").order_by(AiUsageEvent.created_at).all()
    assert [(r.provider, r.success, r.retries) for r in rows] == [
        ("ollama", False, 0),
        ("anthropic", True, 1),
    ]
    assert rows[0].error_category == "timeout"


# --- secrets / privacy ---------------------------------------------


def test_no_prompt_or_secret_is_stored_or_logged(db_session, monkeypatch, caplog):
    secret = "sk-ant-SECRETKEY-do-not-store-me"
    monkeypatch.setattr(settings, "llm_api_key", secret)
    monkeypatch.setattr(router, "AnthropicProvider", lambda: _FakeProvider(input_tokens=1, output_tokens=1))

    with caplog.at_level(logging.INFO):
        router.generate_structured(
            task=AITask.WEBSITE_BRIEF,
            system=f"system prompt mentioning {secret} and confidential client revenue $1.2M",
            user="user prompt with the client's private phone number 0400 000 000",
            schema=SCHEMA,
        )

    row = db_session.query(AiUsageEvent).filter_by(task="website_brief").one()
    # The model stores no free-text columns at all — assert every string value is clean.
    for value in (row.task, row.provider, row.model, row.error_category or ""):
        assert secret not in value
        assert "0400 000 000" not in value
        assert "1.2M" not in value
    for record in caplog.records:
        assert secret not in record.getMessage()
        assert "0400 000 000" not in record.getMessage()


# --- read API -----------------------------------------------------


def _seed(db_session, **kw):
    defaults = dict(
        task="lead_summary", provider="ollama", model="qwen3:30b-a3b", success=True,
        duration_ms=100, input_tokens=None, output_tokens=None, retries=0, error_category=None, cost_usd=0.0,
    )
    defaults.update(kw)
    db_session.add(AiUsageEvent(**defaults))
    db_session.commit()


def test_summary_answers_the_five_operator_questions(db_session):
    _seed(db_session, task="creative_direction", provider="anthropic", model="claude-sonnet-5", cost_usd=0.9)
    _seed(db_session, task="creative_direction", provider="anthropic", model="claude-sonnet-5", cost_usd=0.6)
    _seed(db_session, task="sales_audit", provider="ollama", cost_usd=0.0)
    _seed(db_session, task="review_summary", provider="ollama", success=False, error_category="timeout", cost_usd=None)

    result = usage_service.summary(db_session, since_days=30)

    assert result.total_events == 4
    assert result.total_failures == 1
    assert result.anthropic_events == 2
    assert result.local_events == 2
    assert round(result.known_cost_usd, 2) == 1.5
    # Most expensive task first.
    assert result.by_task[0].task == "creative_direction"
    assert result.by_task[0].model == "claude-sonnet-5"
    assert round(result.by_task[0].cost_usd, 2) == 1.5
    assert any(f.error_category == "timeout" for f in result.recent_failures)


def test_summary_endpoint_is_admin_only(authed_client, member_client, db_session):
    _seed(db_session, task="lead_summary")
    assert member_client.get("/api/v1/ai-usage/summary").status_code == 403
    ok = authed_client.get("/api/v1/ai-usage/summary")
    assert ok.status_code == 200
    assert ok.json()["total_events"] == 1


def test_events_endpoint_filters_and_is_admin_only(authed_client, member_client, db_session):
    _seed(db_session, task="lead_summary", provider="ollama")
    _seed(db_session, task="creative_direction", provider="anthropic", model="claude-sonnet-5", cost_usd=0.1)

    assert member_client.get("/api/v1/ai-usage/events").status_code == 403

    anthropic_only = authed_client.get("/api/v1/ai-usage/events?provider=anthropic").json()
    assert [e["task"] for e in anthropic_only] == ["creative_direction"]
