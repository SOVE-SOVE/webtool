"""
T7 — AI provider health checks. No live Ollama/Anthropic: the HTTP and
SDK layers are mocked. Covers "reachable / model installed / can
generate / configured", the actionable messages, that no paid Anthropic
call is made, and the read endpoint.
"""

import anthropic
import httpx
import pytest

from app.core.settings import settings
from app.integrations.ai import health


@pytest.fixture(autouse=True)
def _ai_settings(monkeypatch):
    monkeypatch.setattr(settings, "ai_local_provider", "ollama")
    monkeypatch.setattr(settings, "ai_local_model", "gpt-oss:20b")
    monkeypatch.setattr(settings, "ollama_base_url", "http://localhost:11434")
    monkeypatch.setattr(settings, "ai_premium_provider", "anthropic")
    monkeypatch.setattr(settings, "ai_premium_model", "")
    monkeypatch.setattr(settings, "llm_model", "claude-sonnet-5")
    monkeypatch.setattr(settings, "llm_api_key", "")


def _mock_get(monkeypatch, *, models=None, exc=None):
    def fake_get(url, timeout):
        if exc:
            raise exc
        return httpx.Response(200, json={"models": [{"name": n} for n in (models or [])]}, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)


# --- local ----------------------------------------------------------


def test_local_connected_when_reachable_and_model_installed(monkeypatch):
    _mock_get(monkeypatch, models=["gpt-oss:20b", "llama3.2:latest"])

    result = health.check_local()

    assert result.ok is True
    assert result.configured is True
    assert result.model == "gpt-oss:20b"
    assert result.model_installed is True
    assert result.detail == "Connected"


def test_local_reports_model_not_installed_with_the_pull_command(monkeypatch):
    _mock_get(monkeypatch, models=["llama3.2:latest"])

    result = health.check_local()

    assert result.ok is False
    assert result.model_installed is False
    assert "not installed" in result.detail
    assert "ollama pull gpt-oss:20b" in result.detail
    assert result.installed_models == ["llama3.2:latest"]


def test_local_unreachable_says_to_check_ollama(monkeypatch):
    _mock_get(monkeypatch, exc=httpx.ConnectError("refused"))

    result = health.check_local()

    assert result.ok is False
    assert "reach Ollama" in result.detail or "Is it running" in result.detail


def test_local_timeout_is_reported_cleanly(monkeypatch):
    _mock_get(monkeypatch, exc=httpx.TimeoutException("slow"))

    result = health.check_local()

    assert result.ok is False
    assert "did not respond" in result.detail


def test_local_bare_model_name_matches_latest_tag(monkeypatch):
    monkeypatch.setattr(settings, "ai_local_model", "llama3.2")
    _mock_get(monkeypatch, models=["llama3.2:latest"])

    assert health.check_local().model_installed is True


def test_local_probe_runs_a_tiny_generation(monkeypatch):
    _mock_get(monkeypatch, models=["gpt-oss:20b"])
    calls = {}

    def fake_post(url, json, timeout):
        calls["json"] = json
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)

    result = health.check_local(probe_generation=True)

    assert result.can_generate is True
    assert calls["json"]["max_tokens"] == 1


# --- premium --------------------------------------------------------


def test_premium_not_configured_without_a_key(monkeypatch):
    result = health.check_premium()

    assert result.configured is False
    assert result.ok is False
    assert "LLM_API_KEY" in result.detail


def test_premium_configured_without_probing_makes_no_api_call(monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "sk-ant-xxxx")

    def explode(*a, **k):
        raise AssertionError("no Anthropic client should be constructed when probe=False")

    monkeypatch.setattr(anthropic, "Anthropic", explode)

    result = health.check_premium(probe_reachability=False)

    assert result.configured is True
    assert result.ok is True
    assert result.detail == "Configured"


def test_premium_probe_uses_a_free_models_list_never_a_generation(monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "sk-ant-xxxx")
    calls = []

    class FakeModels:
        def list(self):
            calls.append("models.list")

    class FakeClient:
        def __init__(self, api_key, timeout):
            self.models = FakeModels()
            self.messages = None  # a generation call would AttributeError loudly

    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)

    result = health.check_premium(probe_reachability=True)

    assert calls == ["models.list"]
    assert result.ok is True
    assert result.detail == "Connected"


def test_premium_probe_reports_a_rejected_key(monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "sk-ant-bad")

    class FakeClient:
        def __init__(self, api_key, timeout):
            self.models = self

        def list(self):
            raise anthropic.AuthenticationError(
                "unauthorized", response=httpx.Response(401, request=httpx.Request("GET", "https://api.anthropic.com")), body=None
            )

    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)

    result = health.check_premium(probe_reachability=True)

    assert result.ok is False
    assert "rejected" in result.detail


# --- endpoint ------------------------------------------------------


def test_status_endpoint_requires_auth(client):
    assert client.get("/api/v1/ai/providers/status").status_code == 401


def test_status_endpoint_returns_both_providers(authed_client, monkeypatch):
    _mock_get(monkeypatch, models=["gpt-oss:20b"])

    body = authed_client.get("/api/v1/ai/providers/status").json()

    assert body["local"]["provider"] == "ollama"
    assert body["local"]["ok"] is True
    assert body["premium"]["provider"] == "anthropic"
    assert body["premium"]["configured"] is False
    assert body["probed"] is False
