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
from app.integrations.ai.providers.base import GenerationResult
from app.integrations.ai.tasks import AITask
from app.integrations.errors import LlmUnavailableError

SCHEMA = {"type": "object"}


class FakeProvider:
    def __init__(self, result=None, error=None, input_tokens=None, output_tokens=None):
        self._data = result if result is not None else {"ok": True}
        self.error = error
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.calls = []

    def generate_structured(self, system, user, schema, model, max_tokens=4096, **kwargs):
        self.calls.append(
            {"system": system, "user": user, "schema": schema, "model": model, "max_tokens": max_tokens, **kwargs}
        )
        if self.error:
            raise self.error
        return GenerationResult(
            data=self._data, input_tokens=self.input_tokens, output_tokens=self.output_tokens
        )


@pytest.fixture(autouse=True)
def _stub_usage_recorder(monkeypatch):
    """Keep router unit tests from writing to the AI usage table — the
    recorder itself is covered by tests/test_ai_usage.py. Collects the
    kwargs each call would have recorded."""
    recorded: list[dict] = []
    monkeypatch.setattr(router.recorder, "record_ai_usage", lambda **kw: recorded.append(kw))
    return recorded


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


def test_llm_module_is_only_an_error_type_re_export_now():
    """As of T8, app.integrations.llm carries no generate_structured —
    every agent routes through the router. It exists only so the
    historical `LlmUnavailableError` import path keeps working for
    app.main's exception handler."""
    from app.integrations.errors import LlmUnavailableError as CanonicalError

    assert llm.LlmUnavailableError is CanonicalError
    assert not hasattr(llm, "generate_structured")


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


# Agents migrated off the legacy always-premium llm.py path onto the
# router, and the AITask each one must be routing on. Extend this dict
# (not a new bespoke test) as more agents migrate — a regression here
# would silently route an agent back onto the legacy path, or a LOCAL
# task onto the wrong lane, without any single call site noticing.
MIGRATED_AGENTS: dict[str, str] = {
    "review_intelligence.py": "AITask.REVIEW_SUMMARY",
    "follow_up.py": "AITask.FOLLOW_UP_RECOMMENDATION",
    "meeting_brief.py": "AITask.MEETING_BRIEF",
    "creative_director.py": "AITask.CREATIVE_DIRECTION",
    "sitemap.py": "AITask.SITEMAP_PLANNING",
    "website_brief.py": "AITask.WEBSITE_BRIEF",
    "website_revision.py": "AITask.WEBSITE_REVISION",
    "planning_visual_review.py": "AITask.VISUAL_DESIGN_REVIEW",
    "sales_audit.py": "AITask.SALES_AUDIT",
    "planning_summary.py": "AITask.PLANNING_SUMMARY",
    "outreach.py": "AITask.OUTREACH_DRAFTING",
}

# No agent may still import the legacy always-premium
# app.integrations.llm.generate_structured — every LLM call site now
# goes through the router, so provider choice is never hard-coded in a
# feature. (LlmUnavailableError, the error type, is still fine to import.)
def test_no_agent_still_uses_the_legacy_llm_generate_structured():
    agents_dir = pathlib.Path(__file__).parent.parent / "app" / "agents"
    offenders = [
        path.name
        for path in agents_dir.glob("*.py")
        if "from app.integrations.llm import generate_structured" in path.read_text(encoding="utf-8")
        or "llm.generate_structured" in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


# The website-creation pipeline: every LLM step that shapes what a
# paying client sees must route to a PREMIUM task, so it can never run
# on the local model. See docs/09_AI_WEBSITE_PIPELINE.md.
WEBSITE_PIPELINE_PREMIUM_TASKS = [
    AITask.WEBSITE_BRIEF,
    AITask.SITEMAP_PLANNING,
    AITask.CREATIVE_DIRECTION,
    AITask.WEBSITE_GENERATION,
    AITask.WEBSITE_REVISION,
    AITask.DESIGN_REFINEMENT,
    AITask.COMPLEX_WEBSITE_REASONING,
    AITask.VISUAL_DESIGN_REVIEW,
]


@pytest.mark.parametrize("task", WEBSITE_PIPELINE_PREMIUM_TASKS)
def test_website_pipeline_task_never_routes_to_local(task, monkeypatch):
    ollama = FakeProvider(result={"should": "never be called"})
    anthropic_fake = FakeProvider(result={"ok": True})
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: ollama)
    monkeypatch.setattr(router, "AnthropicProvider", lambda: anthropic_fake)
    # Even with fallback ON, a premium task must not touch the local model.
    monkeypatch.setattr(settings, "ai_local_fallback_to_premium", True)

    router.generate_structured(task=task, system="s", user="u", schema=SCHEMA)

    assert ollama.calls == []
    assert len(anthropic_fake.calls) == 1


def test_images_on_a_local_task_is_rejected(monkeypatch):
    fake = FakeProvider()
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: fake)

    with pytest.raises(LlmUnavailableError, match="cannot process images"):
        router.generate_structured(
            task=AITask.LEAD_SUMMARY, system="s", user="u", schema=SCHEMA, images_base64=["Zm9v"]
        )
    assert fake.calls == []


def test_images_on_a_premium_task_pass_through_to_anthropic(monkeypatch):
    captured = {}

    class ImageAwareFake:
        def generate_structured(self, system, user, schema, model, max_tokens=4096, images_base64=None):
            captured["images"] = images_base64
            return GenerationResult(data={"findings": []})

    monkeypatch.setattr(router, "AnthropicProvider", lambda: ImageAwareFake())

    router.generate_structured(
        task=AITask.VISUAL_DESIGN_REVIEW, system="s", user="u", schema=SCHEMA, images_base64=["Zm9v"]
    )

    assert captured["images"] == ["Zm9v"]


@pytest.mark.parametrize("filename,expected_task", MIGRATED_AGENTS.items())
def test_agent_is_migrated_onto_the_router(filename, expected_task):
    agents_dir = pathlib.Path(__file__).parent.parent / "app" / "agents"
    src = (agents_dir / filename).read_text(encoding="utf-8")
    assert "from app.integrations.ai.router import generate_structured" in src
    assert expected_task in src


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


def test_creative_director_agent_calls_router_with_creative_direction_task(monkeypatch):
    from app.agents import creative_director as creative_director_agent

    captured = {}
    fake_output = {
        "facts": ["Business is a plumber based in Ballarat."],
        "assumptions": [],
        "creative_concept": "Trustworthy local trade, fast response",
        "visual_direction": "Clean, high-contrast, trade-blue palette",
        "brand_personality": ["reliable", "prompt"],
        "colour_direction": "Blue and white, high contrast",
        "typography_direction": "Bold sans-serif headings",
        "image_direction": "Real job-site photos",
        "layout_direction": "Single-page, phone-first",
        "ux_direction": "Click-to-call prominent",
        "tone_of_voice": "Direct, no-nonsense",
        "visual_hierarchy": "Phone number first",
        "cta_strategy": "Call now, repeated",
        "things_to_avoid": ["stock photos"],
        "references_inspiration": [],
    }

    def fake_generate_structured(*, task, system, user, schema, max_tokens=4096):
        captured["task"] = task
        return dict(fake_output)

    monkeypatch.setattr(creative_director_agent, "generate_structured", fake_generate_structured)

    result = creative_director_agent.run(
        creative_director_agent.CreativeDirectorInput(
            business_name="Riverside Plumbing",
            industry="trade",
            suburb="Ballarat",
            state="VIC",
            website_url=None,
            social_links=None,
            business_notes=None,
            project_name="Riverside Plumbing site",
            project_stage="creative_direction",
            website_audit=None,
            prior_research_summary=None,
            prior_website_strengths=None,
            prior_top_problems=None,
            prior_suggested_structure=None,
            prior_suggested_offer=None,
            target_audience="Homeowners needing urgent plumbing repairs",
            business_goals="Get more emergency call-outs",
            additional_notes=None,
            intake_notes=None,
        )
    )

    assert captured["task"] == AITask.CREATIVE_DIRECTION
    assert result.output.creative_concept == fake_output["creative_concept"]


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
