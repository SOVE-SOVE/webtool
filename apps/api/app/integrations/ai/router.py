"""
AI task router — TASK -> PROVIDER -> MODEL. This is the ONLY place that
decides which provider handles a given AI task. No feature/agent file
should import a provider (app/integrations/ai/providers/) directly or
branch on provider choice itself.

As of T5 every LLM-calling agent routes through here (see
app/agents/*.py and tests/test_ai_router.py's MIGRATED_AGENTS table).
LOCAL/PREMIUM placement for each task is in tasks.py; the website-
creation pipeline's premium-only rule is documented in
docs/09_AI_WEBSITE_PIPELINE.md.

Every call (success or failure) also writes one AiUsageEvent row via
app/modules/ai_usage/recorder.py (T6) — task, provider, model, timing,
token counts, retries, error category, estimated cost. That recording
is strictly best-effort: it can never raise into or slow the caller.
"""

import time

from app.core.settings import settings
from app.integrations.ai.errors import AIProviderError, AIProviderUnavailableError
from app.integrations.ai.providers.anthropic_provider import AnthropicProvider
from app.integrations.ai.providers.base import AIProvider, GenerationResult
from app.integrations.ai.providers.ollama_provider import OllamaProvider
from app.integrations.ai.tasks import AITask
from app.modules.ai_usage import recorder

LOCAL_TASKS: frozenset[AITask] = frozenset(
    {
        AITask.WEBSITE_AUDIT,
        AITask.LEAD_SUMMARY,
        AITask.GOOGLE_REVIEW_ANALYSIS,
        AITask.REVIEW_SUMMARY,
        AITask.REVIEW_THEME_EXTRACTION,
        AITask.LEAD_SCORING,
        AITask.RESEARCH_SUMMARY,
        AITask.MEETING_BRIEF,
        AITask.PROPOSAL_GENERATION,
        AITask.CLIENT_SUMMARY,
        AITask.PROJECT_SUMMARY,
        AITask.FOLLOW_UP_RECOMMENDATION,
        AITask.SALES_AUDIT,
        AITask.OUTREACH_DRAFTING,
        AITask.PLANNING_SUMMARY,
    }
)

PREMIUM_TASKS: frozenset[AITask] = frozenset(
    {
        AITask.CREATIVE_DIRECTION,
        AITask.WEBSITE_GENERATION,
        AITask.WEBSITE_REVISION,
        AITask.DESIGN_REFINEMENT,
        AITask.COMPLEX_WEBSITE_REASONING,
        AITask.SITEMAP_PLANNING,
        AITask.WEBSITE_BRIEF,
        AITask.VISUAL_DESIGN_REVIEW,
    }
)

# Every AITask must be routed exactly once — a new task added to tasks.py
# without being added to one of the two sets above fails at import time
# rather than silently falling through to a default provider.
assert not (LOCAL_TASKS & PREMIUM_TASKS), "a task cannot be both LOCAL and PREMIUM"
assert LOCAL_TASKS | PREMIUM_TASKS == frozenset(AITask), (
    "every AITask must be routed in exactly one of LOCAL_TASKS / PREMIUM_TASKS"
)


def _local_provider() -> tuple[AIProvider, str]:
    if settings.ai_local_provider != "ollama":
        raise AIProviderError(
            f"AI generation is unavailable — unsupported AI_LOCAL_PROVIDER "
            f"{settings.ai_local_provider!r} (only 'ollama' is implemented)."
        )
    return (
        OllamaProvider(base_url=settings.ollama_base_url, timeout_seconds=settings.ollama_timeout_seconds),
        settings.ai_local_model,
    )


def _premium_provider() -> tuple[AIProvider, str]:
    if settings.ai_premium_provider != "anthropic":
        raise AIProviderError(
            f"AI generation is unavailable — unsupported AI_PREMIUM_PROVIDER "
            f"{settings.ai_premium_provider!r} (only 'anthropic' is implemented)."
        )
    return AnthropicProvider(), (settings.ai_premium_model or settings.llm_model)


def is_local(task: AITask) -> bool:
    """Whether `task` routes to the local model. The single source of
    truth — callers must never re-derive this from settings themselves."""
    return task in LOCAL_TASKS


def resolve_provider_and_model(task: AITask) -> tuple[str, str]:
    """The provider name ("ollama" / "anthropic") and model id that
    `generate_structured` would use for `task` right now, without making
    a call. For recording `model_used` on a generated artifact (and, later,
    the AI usage log) — so what's stored reflects where the work actually
    ran, not a hard-coded guess."""
    if task in LOCAL_TASKS:
        return settings.ai_local_provider, settings.ai_local_model
    return settings.ai_premium_provider, (settings.ai_premium_model or settings.llm_model)


def resolve_model(task: AITask) -> str:
    return resolve_provider_and_model(task)[1]


def _error_category(exc: Exception) -> str:
    """Coarse bucket for the AI usage log — enough to answer 'which
    calls are failing and roughly why', not a full taxonomy."""
    message = str(exc).lower()
    if "timed out" in message or "timeout" in message:
        return "timeout"
    if isinstance(exc, AIProviderUnavailableError):
        return "provider_unreachable"
    if isinstance(exc, AIProviderError):
        return "provider_error"
    return "unexpected"


def _run_attempt(
    provider: AIProvider,
    provider_name: str,
    model: str,
    *,
    task: AITask,
    retries: int,
    system: str,
    user: str,
    schema: dict,
    max_tokens: int,
    images_base64: list[str] | None,
) -> dict:
    """One provider call, wrapped in usage recording (best-effort — a
    recording failure never touches the caller). Returns the parsed
    `data`; re-raises any AIProviderError after recording it."""
    started = time.monotonic()
    kwargs = {"images_base64": images_base64} if images_base64 else {}
    try:
        result: GenerationResult = provider.generate_structured(
            system=system, user=user, schema=schema, model=model, max_tokens=max_tokens, **kwargs
        )
    except AIProviderError as exc:
        _safe_record(
            task=task, provider=provider_name, model=model, success=False,
            duration_ms=_elapsed_ms(started), retries=retries, error_category=_error_category(exc),
        )
        raise
    _safe_record(
        task=task, provider=provider_name, model=model, success=True,
        duration_ms=_elapsed_ms(started), retries=retries,
        input_tokens=result.input_tokens, output_tokens=result.output_tokens,
    )
    return result.data


def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _safe_record(**kwargs) -> None:
    try:
        recorder.record_ai_usage(**{k: (v.value if isinstance(v, AITask) else v) for k, v in kwargs.items()})
    except Exception:  # noqa: BLE001 — observability must never break generation
        pass


def generate_structured(
    task: AITask,
    system: str,
    user: str,
    schema: dict,
    max_tokens: int = 4096,
    images_base64: list[str] | None = None,
) -> dict:
    """
    Routes `task` to the correct provider/model (per LOCAL_TASKS /
    PREMIUM_TASKS above) and returns parsed JSON matching `schema`.

    If the routed provider is unavailable, this raises rather than
    silently trying the other provider — controlling AI cost is the
    entire point of task-based routing, so a LOCAL task failing must
    surface as a real error (LlmUnavailableError -> 503), not
    automatically and invisibly become an expensive premium call. The
    one exception is explicit and opt-in: settings.ai_local_fallback_to_premium
    (default False).

    `images_base64` (PNG screenshots attached to the user message) is
    only supported for PREMIUM tasks — the local Ollama provider has no
    vision path. Passing images with a LOCAL task is a programming error
    and raises immediately rather than silently dropping them.
    """
    if images_base64 and task in LOCAL_TASKS:
        raise AIProviderError(
            f"AI generation is unavailable — task {task.value!r} routes to the local "
            f"model, which cannot process images. Route image tasks to a PREMIUM task."
        )

    call = dict(
        task=task, system=system, user=user, schema=schema,
        max_tokens=max_tokens, images_base64=images_base64,
    )

    if task in LOCAL_TASKS:
        provider, model = _local_provider()
        try:
            return _run_attempt(provider, settings.ai_local_provider, model, retries=0, **call)
        except AIProviderError:
            if not settings.ai_local_fallback_to_premium:
                raise
        # Opt-in fallback: the local provider failed and the operator has
        # explicitly accepted the premium cost. Recorded as retries=1.
        provider, model = _premium_provider()
        return _run_attempt(provider, settings.ai_premium_provider, model, retries=1, **call)

    provider, model = _premium_provider()
    return _run_attempt(provider, settings.ai_premium_provider, model, retries=0, **call)
