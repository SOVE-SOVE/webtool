"""
Deployment provider abstraction (roadmap M6). A `DeploymentProvider`
takes a prepared site bundle and publishes it somewhere, returning a
`DeploymentOutcome`. `modules/deployments/service.py` codes against this
interface, not against a concrete provider, so a real host (Vercel,
Netlify, ...) can be added later without touching the calling code.

Only `MockDeploymentProvider` exists today — no real hosting account is
configured (see `settings.deploy_provider`). It never makes a network
call, never touches the filesystem, and never claims a real deployment
happened: every result carries `target="mock"` and an obviously-fake
`.mock-deploy.internal` URL, so a mock result can never be mistaken for
a real, publicly reachable site. This is deliberate per the "do not
pretend a real deployment occurred" requirement — a future real
provider is a new class implementing the same interface, selected by
`get_deployment_provider()`, not a flag that makes this one lie.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.core.settings import settings


@dataclass
class DeploymentBundle:
    """Everything a provider needs to publish one website version."""

    business_slug: str
    environment: str
    config: dict


@dataclass
class DeploymentOutcome:
    ok: bool
    target: str
    url: str | None = None
    detail: dict = field(default_factory=dict)
    error: str | None = None


class DeploymentProvider:
    """Interface every deployment provider implements."""

    name: str = "base"

    def deploy(self, bundle: DeploymentBundle) -> DeploymentOutcome:
        raise NotImplementedError


_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    slug = _NON_SLUG_CHARS.sub("-", text.lower()).strip("-")
    return slug or "site"


class MockDeploymentProvider(DeploymentProvider):
    """
    Safe development/dev implementation — the only provider available
    until a real hosting account is configured. "Deploying" means
    validating the bundle is servable and returning a synthetic result;
    no network call, no filesystem write, nothing that could be
    mistaken for a real publish.
    """

    name = "mock"

    def deploy(self, bundle: DeploymentBundle) -> DeploymentOutcome:
        pages = bundle.config.get("pages") or []
        if not pages:
            return DeploymentOutcome(ok=False, target=self.name, error="No pages in the site bundle to deploy")

        subdomain = f"{_slugify(bundle.business_slug)}-{bundle.environment}"
        return DeploymentOutcome(
            ok=True,
            target=self.name,
            url=f"https://{subdomain}.mock-deploy.internal",
            detail={
                "provider": "mock",
                "note": "No real hosting is configured — this is a simulated deployment, not a live site.",
                "pages_deployed": len(pages),
                "page_slugs": [p.get("slug") for p in pages],
            },
        )


def get_deployment_provider() -> DeploymentProvider:
    """
    Factory for the configured provider. `settings.deploy_provider`
    exists as the real extension point for later (e.g. "vercel") — it
    only ever resolves to the mock today, and fails loudly rather than
    silently falling back if it's ever pointed at something unbuilt, so
    a misconfiguration can't be mistaken for a working real deployment.
    """
    if settings.deploy_provider != "mock":
        raise NotImplementedError(
            f"No deployment provider implemented for '{settings.deploy_provider}' — only 'mock' exists today."
        )
    return MockDeploymentProvider()
