"""
Maps `settings.deploy_provider` to the adapter that runs it — the one
place `modules/deployments/service.py` touches a concrete deployment
provider. Adding a real provider later is registering its factory
here, not changing the service. Same shape as
`app/integrations/calendar/registry.py` and
`app/integrations/discovery/registry.py`.

Every real provider's factory fails loudly (raises
`DeploymentProviderError`) if its required credentials aren't
configured — selecting "vercel" with no `VERCEL_API_TOKEN` is a
misconfiguration, not a reason to silently deploy through mock
instead. `mock` alone never fails to construct, since it needs no
credentials.
"""

from __future__ import annotations

from app.core.settings import settings
from app.integrations.deployment.base import DeploymentProvider, DeploymentProviderError
from app.integrations.deployment.cloudflare_provider import get_cloudflare_provider
from app.integrations.deployment.mock_provider import MockDeploymentProvider
from app.integrations.deployment.netlify_provider import get_netlify_provider
from app.integrations.deployment.traditional_provider import get_traditional_provider
from app.integrations.deployment.vercel_provider import get_vercel_provider

DEFAULT_PROVIDER = "mock"

_FACTORIES = {
    "mock": lambda: MockDeploymentProvider(),
    "vercel": get_vercel_provider,
    "netlify": get_netlify_provider,
    "cloudflare": get_cloudflare_provider,
    "traditional": get_traditional_provider,
}


def get_deployment_provider(name: str | None = None) -> DeploymentProvider:
    """Factory for the configured provider. Raises `DeploymentProviderError`
    for an unknown name, and lets each real provider's own factory raise
    the same error for missing credentials — nothing here ever silently
    substitutes mock for a provider that was explicitly requested."""
    key = name or settings.deploy_provider
    factory = _FACTORIES.get(key)
    if factory is None:
        raise DeploymentProviderError(f"Unknown deployment provider: {key!r} — available: {', '.join(_FACTORIES)}.")
    return factory()


def available_providers() -> list[str]:
    return list(_FACTORIES)
