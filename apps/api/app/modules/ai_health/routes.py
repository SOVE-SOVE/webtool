"""
AI provider status (T7). One read endpoint behind auth — surfaces
whether the local (Ollama) and premium (Anthropic) providers are
reachable and, for local, whether the configured model is installed.
No secrets in the response; the app never downloads a model.
"""

from fastapi import APIRouter, Depends, Query

from app.core.auth import get_current_user
from app.integrations.ai import health
from app.integrations.ai.health import ProviderHealth
from app.modules.ai_health.schemas import AiProvidersStatus, ProviderStatus
from app.modules.users.models import User

router = APIRouter(prefix="/api/v1/ai/providers", tags=["ai-providers"])


def _to_status(h: ProviderHealth) -> ProviderStatus:
    return ProviderStatus(
        provider=h.provider,
        configured=h.configured,
        ok=h.ok,
        detail=h.detail,
        model=h.model,
        model_installed=h.model_installed,
        can_generate=h.can_generate,
        installed_models=h.installed_models,
    )


@router.get("/status", response_model=AiProvidersStatus)
def get_status(
    probe: bool = Query(
        default=False,
        description="Run the live reachability / 1-token generation probe (slower). "
        "Default checks configuration + the Ollama model list only.",
    ),
    _: User = Depends(get_current_user),
) -> AiProvidersStatus:
    return AiProvidersStatus(
        local=_to_status(health.check_local(probe_generation=probe)),
        premium=_to_status(health.check_premium(probe_reachability=probe)),
        probed=probe,
    )
