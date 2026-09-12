"""
T5 — end-to-end proof that real agents route through the real
app.integrations.ai.router (not a monkeypatched shortcut), that the
website-creation pipeline lands on the PREMIUM provider/model, and that
routine tasks land on the LOCAL one. Only the provider *classes* the
router instantiates are faked here; everything above them
(agent -> router -> task set -> provider selection) is the real code.
"""

import pytest

from app.agents import creative_director, planning_summary
from app.agents.planning_audit import Finding
from app.core.settings import settings
from app.integrations.ai import router as ai_router
from app.integrations.ai.providers.base import GenerationResult

PREMIUM_MODEL = "claude-sonnet-5"
LOCAL_MODEL = "qwen3:30b-a3b"


@pytest.fixture(autouse=True)
def _stub_usage_recorder(monkeypatch):
    monkeypatch.setattr(ai_router.recorder, "record_ai_usage", lambda **kw: None)


class RecordingProvider:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def generate_structured(self, system, user, schema, model, max_tokens=4096, **kwargs):
        self.calls.append({"model": model, "system": system, "user": user, **kwargs})
        return GenerationResult(data=dict(self.result))


@pytest.fixture(autouse=True)
def _ai_settings(monkeypatch):
    monkeypatch.setattr(settings, "ai_local_provider", "ollama")
    monkeypatch.setattr(settings, "ai_local_model", LOCAL_MODEL)
    monkeypatch.setattr(settings, "ai_premium_provider", "anthropic")
    monkeypatch.setattr(settings, "ai_premium_model", "")
    monkeypatch.setattr(settings, "llm_model", PREMIUM_MODEL)
    monkeypatch.setattr(settings, "ai_local_fallback_to_premium", False)


@pytest.fixture
def providers(monkeypatch):
    from app.integrations.ai import router

    premium = RecordingProvider(
        {
            "facts": ["Plumber based in Ballarat."],
            "assumptions": [],
            "creative_concept": "Trustworthy local trade",
            "visual_direction": "Clean, high-contrast",
            "brand_personality": ["reliable"],
            "colour_direction": "Blue and white",
            "typography_direction": "Bold sans-serif",
            "image_direction": "Real job-site photos",
            "layout_direction": "Phone-first",
            "ux_direction": "Click-to-call prominent",
            "tone_of_voice": "Direct",
            "visual_hierarchy": "Phone number first",
            "cta_strategy": "Call now",
            "things_to_avoid": ["stock photos"],
            "references_inspiration": [],
        }
    )
    local = RecordingProvider({"website_summary": "The site loads slowly and lacks a clear call to action."})
    monkeypatch.setattr(router, "AnthropicProvider", lambda: premium)
    monkeypatch.setattr(router, "OllamaProvider", lambda base_url, timeout_seconds: local)
    return premium, local


def _creative_input():
    return creative_director.CreativeDirectorInput(
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
        prior_research_summary="Established local plumber; site is dated and slow.",
        prior_website_strengths=["Clear service list"],
        prior_top_problems=["No mobile layout", "No booking"],
        prior_suggested_structure=["Home", "Services", "Contact"],
        prior_suggested_offer="Emergency call-out landing page",
        target_audience="Homeowners needing urgent repairs",
        business_goals="More emergency call-outs",
        additional_notes=None,
        intake_notes=None,
    )


def test_creative_direction_runs_on_the_premium_provider(providers):
    premium, local = providers

    result = creative_director.run(_creative_input())

    assert result.output.creative_concept == "Trustworthy local trade"
    assert len(premium.calls) == 1
    assert premium.calls[0]["model"] == PREMIUM_MODEL
    assert local.calls == [], "a website-creation step must never touch the local model"


def test_creative_direction_stays_premium_even_with_fallback_enabled(providers, monkeypatch):
    premium, local = providers
    monkeypatch.setattr(settings, "ai_local_fallback_to_premium", True)

    creative_director.run(_creative_input())

    assert len(premium.calls) == 1
    assert local.calls == []


def test_creative_direction_prompt_is_the_full_checked_in_template(providers):
    premium, _ = providers
    creative_director.run(_creative_input())
    system = premium.calls[0]["system"]
    # The real prompt file, not a trimmed-for-local-model version.
    expected = (creative_director._PROMPT_PATH).read_text(encoding="utf-8")
    assert system == expected
    assert len(system) > 500


def test_routine_planning_summary_runs_on_the_local_provider(providers):
    premium, local = providers

    result = planning_summary.run(
        planning_summary.PlanningSummaryInput(
            business_name="Riverside Plumbing",
            has_website=True,
            findings=[
                Finding(
                    area="performance",
                    category="speed",
                    severity="high",
                    message="Largest Contentful Paint is 6.2s",
                    evidence="measured",
                    confidence=1.0,
                )
            ],
        )
    )

    assert result.output.website_summary
    assert len(local.calls) == 1
    assert local.calls[0]["model"] == LOCAL_MODEL
    assert premium.calls == []
