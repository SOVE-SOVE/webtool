"""
Tests for app.integrations.ai.router — task -> provider -> model routing
(T3). See the T1 report for how the 9 existing AI call sites route today
(this module doesn't touch any of them) and the T2 report for the local
model this config defaults to (qwen3:30b-a3b).
"""

import pathlib

import pytest

from app.core.settings import settings
from app.integrations import llm
from app.integrations.ai import router
from app.integrations.ai.errors import AIProviderUnavailableError
from app.integrations.ai.tasks import AITask
from app.integrations.errors import LlmUnavailableError

SCHEMA = {"type": "object"}


class FakeProvider:
    def __init__(self, result=None, error=None):
        self.result = result if result is not None else {"ok": True}
        self.error = error
        self.calls = []

    def generate_structured(self, system, user, schema, model, max_tokens=4096):
        self.calls.append(
            {"system": system, "user": user, "schema": schema, "model": model, "max_tokens": max_tokens}
        )
        if self.error:
            raise self.error
        return self.result


@pytest.fixture(autouse=True)
def _ai_settings(monkeypatch):
    monkeypatch.setattr(settings, "ai_local_provider", "ollama")
    monkeypatch.setattr(settings, "ai_local_model", "qwen3:30b-a3b")
    monkeypatch.setattr(settings, "ai_premium_provider", "anthropic")
    monkeypatch.setattr(settings, "ai_premium_model", "")
    monkeypatch.setattr(settings, "llm_model", "claude-sonnet-5")
    monkeypatch.setattr(settings, "ollama_base_url", "http://fake-ollama:11434")
    monkeypatch.setattr(settings, "ai_local_fallback_to_premium", False)


def test_local_task_routes_to_ollama(monkeypatch):
    fake = FakeProvider(result={"summary": "local result"})
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: fake)

    result = router.generate_structured(task=AITask.REVIEW_SUMMARY, system="sys", user="usr", schema=SCHEMA)

    assert result == {"summary": "local result"}
    assert len(fake.calls) == 1
    assert fake.calls[0]["model"] == "qwen3:30b-a3b"


def test_premium_task_routes_to_anthropic(monkeypatch):
    fake = FakeProvider(result={"direction": "premium result"})
    monkeypatch.setattr(router, "AnthropicProvider", lambda: fake)

    result = router.generate_structured(task=AITask.CREATIVE_DIRECTION, system="sys", user="usr", schema=SCHEMA)

    assert result == {"direction": "premium result"}
    assert fake.calls[0]["model"] == "claude-sonnet-5"


def test_local_model_configuration_is_respected(monkeypatch):
    monkeypatch.setattr(settings, "ai_local_model", "gpt-oss:20b")
    fake = FakeProvider()
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: fake)

    router.generate_structured(task=AITask.LEAD_SCORING, system="sys", user="usr", schema=SCHEMA)

    assert fake.calls[0]["model"] == "gpt-oss:20b"


def test_premium_model_configuration_is_respected(monkeypatch):
    monkeypatch.setattr(settings, "ai_premium_model", "claude-opus-5")
    fake = FakeProvider()
    monkeypatch.setattr(router, "AnthropicProvider", lambda: fake)

    router.generate_structured(task=AITask.WEBSITE_GENERATION, system="sys", user="usr", schema=SCHEMA)

    assert fake.calls[0]["model"] == "claude-opus-5"


def test_blank_premium_model_falls_back_to_llm_model(monkeypatch):
    monkeypatch.setattr(settings, "ai_premium_model", "")
    monkeypatch.setattr(settings, "llm_model", "claude-sonnet-5-fallback")
    fake = FakeProvider()
    monkeypatch.setattr(router, "AnthropicProvider", lambda: fake)

    router.generate_structured(task=AITask.WEBSITE_REVISION, system="sys", user="usr", schema=SCHEMA)

    assert fake.calls[0]["model"] == "claude-sonnet-5-fallback"


def test_ollama_unavailable_raises_controlled_failure_without_fallback(monkeypatch):
    failing = FakeProvider(error=AIProviderUnavailableError("connection refused"))
    anthropic_fake = FakeProvider(result={"should": "not be called"})
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: failing)
    monkeypatch.setattr(router, "AnthropicProvider", lambda: anthropic_fake)

    with pytest.raises(LlmUnavailableError):
        router.generate_structured(task=AITask.MEETING_BRIEF, system="sys", user="usr", schema=SCHEMA)

    assert anthropic_fake.calls == []


def test_ollama_unavailable_with_fallback_enabled_uses_anthropic(monkeypatch):
    monkeypatch.setattr(settings, "ai_local_fallback_to_premium", True)
    failing = FakeProvider(error=AIProviderUnavailableError("connection refused"))
    anthropic_fake = FakeProvider(result={"used": "premium fallback"})
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: failing)
    monkeypatch.setattr(router, "AnthropicProvider", lambda: anthropic_fake)

    result = router.generate_structured(task=AITask.MEETING_BRIEF, system="sys", user="usr", schema=SCHEMA)

    assert result == {"used": "premium fallback"}
    assert len(anthropic_fake.calls) == 1


def test_anthropic_remains_functional_via_llm_module(monkeypatch):
    """The 9 existing agent call sites all use app.integrations.llm
    directly — this must keep working unchanged after the refactor."""

    class FakeAnthropicProvider:
        def generate_structured(self, system, user, schema, model, max_tokens=4096, images_base64=None):
            assert model == "claude-sonnet-5"
            return {"legacy": "still works"}

    monkeypatch.setattr(llm, "_provider", FakeAnthropicProvider())

    result = llm.generate_structured(system="sys", user="usr", schema=SCHEMA)

    assert result == {"legacy": "still works"}


def test_no_api_key_appears_in_error_messages(monkeypatch):
    secret = "sk-ant-do-not-leak-this-12345"
    monkeypatch.setattr(settings, "llm_api_key", secret)
    failing = FakeProvider(error=AIProviderUnavailableError(f"failed to reach {settings.ollama_base_url}"))
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: failing)

    with pytest.raises(LlmUnavailableError) as exc_info:
        router.generate_structured(task=AITask.LEAD_SUMMARY, system="sys", user="usr", schema=SCHEMA)

    assert secret not in str(exc_info.value)


def test_unsupported_local_provider_fails_loudly(monkeypatch):
    monkeypatch.setattr(settings, "ai_local_provider", "some_other_provider")

    with pytest.raises(LlmUnavailableError, match="some_other_provider"):
        router.generate_structured(task=AITask.LEAD_SUMMARY, system="sys", user="usr", schema=SCHEMA)


def test_unsupported_premium_provider_fails_loudly(monkeypatch):
    monkeypatch.setattr(settings, "ai_premium_provider", "some_other_provider")

    with pytest.raises(LlmUnavailableError, match="some_other_provider"):
        router.generate_structured(task=AITask.CREATIVE_DIRECTION, system="sys", user="usr", schema=SCHEMA)


def test_every_task_is_routed_exactly_once():
    assert not (router.LOCAL_TASKS & router.PREMIUM_TASKS)
    assert router.LOCAL_TASKS | router.PREMIUM_TASKS == frozenset(AITask)


def test_no_agent_module_imports_a_provider_directly():
    """Provider selection must not happen inside individual feature
    implementations — only router.py (and the legacy llm.py path) may
    import a provider class."""
    agents_dir = pathlib.Path(__file__).parent.parent / "app" / "agents"
    offenders = [
        str(path)
        for path in agents_dir.glob("*.py")
        if "app.integrations.ai.providers" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_review_intelligence_and_follow_up_are_migrated_onto_the_router():
    """First two agents migrated off the legacy llm.py path (both were
    the strongest LOCAL candidates in the T1 audit) — a regression here
    would silently route them back onto the always-premium legacy path."""
    agents_dir = pathlib.Path(__file__).parent.parent / "app" / "agents"

    review_intelligence_src = (agents_dir / "review_intelligence.py").read_text(encoding="utf-8")
    assert "from app.integrations.ai.router import generate_structured" in review_intelligence_src
    assert "AITask.REVIEW_SUMMARY" in review_intelligence_src

    follow_up_src = (agents_dir / "follow_up.py").read_text(encoding="utf-8")
    assert "from app.integrations.ai.router import generate_structured" in follow_up_src
    assert "AITask.FOLLOW_UP_RECOMMENDATION" in follow_up_src

    meeting_brief_src = (agents_dir / "meeting_brief.py").read_text(encoding="utf-8")
    assert "from app.integrations.ai.router import generate_structured" in meeting_brief_src
    assert "AITask.MEETING_BRIEF" in meeting_brief_src


def test_meeting_brief_agent_calls_router_with_meeting_brief_task(monkeypatch):
    from app.agents import meeting_brief as meeting_brief_agent

    captured = {}

    def fake_generate_structured(*, task, system, user, schema, max_tokens=4096):
        captured["task"] = task
        return {"questions_to_ask": ["What's the timeline?"], "likely_requirements": ["Booking form"]}

    monkeypatch.setattr(meeting_brief_agent, "generate_structured", fake_generate_structured)

    result = meeting_brief_agent.run(
        meeting_brief_agent.MeetingBriefDiscoveryInput(
            business_name="Acme Plumbing",
            industry="trade",
            lead_status="qualified",
            lead_priority="high",
            lead_score=70,
            lead_notes=None,
            meeting_title="Discovery call",
            meeting_type="discovery_call",
            scheduled_at="2026-09-15T10:00:00Z",
            website_strengths=[],
            website_weaknesses=["no online booking"],
            website_opportunities=["online booking widget"],
            objections=[],
            possible_package="Starter site",
            prior_outreach=[],
            prior_interactions=[],
        )
    )

    assert captured["task"] == AITask.MEETING_BRIEF
    assert result.output.questions_to_ask == ["What's the timeline?"]


def test_follow_up_agent_calls_router_with_follow_up_task(monkeypatch):
    from app.agents import follow_up as follow_up_agent

    captured = {}

    def fake_generate_structured(*, task, system, user, schema, max_tokens=4096):
        captured["task"] = task
        return {"channel": "email", "due_in_days": 5, "suggested_next_action": "Send a short check-in email."}

    monkeypatch.setattr(follow_up_agent, "generate_structured", fake_generate_structured)

    result = follow_up_agent.run(
        follow_up_agent.FollowUpInput(
            business_name="Acme Plumbing",
            industry="trade",
            suburb="Ballarat",
            state="VIC",
            lead_status="contacted",
            lead_score=60,
            prior_outreach=[],
        )
    )

    assert captured["task"] == AITask.FOLLOW_UP_RECOMMENDATION
    assert result.output.channel == "email"
