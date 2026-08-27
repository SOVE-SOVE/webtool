"""
Safe development/test implementation — the only provider actually
exercised until a real hosting account is configured (see
`settings.deploy_provider`). "Deploying" means running the real,
shared `build_static_site` step and returning a synthetic publish
result; no network call, no filesystem write, nothing that could be
mistaken for a real publish. Every result carries `target="mock"` and
an obviously-fake `.mock-deploy.internal` URL, so a mock result can
never be mistaken for a real, publicly reachable site. This is
deliberate per the "do not pretend a real deployment occurred"
requirement — a real provider is a new class implementing the same
interface, not a flag that makes this one lie.

Also the one provider that implements every optional lifecycle method
(`get_status`, `rollback`) so the full monitor/rollback workflow is
exercisable end to end in development without a real hosting account.
"""

from __future__ import annotations

import re
import uuid

from app.integrations.deployment.base import (
    BuildArtifact,
    DeploymentBundle,
    DeploymentOutcome,
    DeploymentProvider,
    DeploymentStatus,
)

_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    slug = _NON_SLUG_CHARS.sub("-", text.lower()).strip("-")
    return slug or "site"


class MockDeploymentProvider(DeploymentProvider):
    name = "mock"
    configured = True

    def deploy(self, bundle: DeploymentBundle, artifact: BuildArtifact) -> DeploymentOutcome:
        if not artifact.ok:
            return DeploymentOutcome(ok=False, target=self.name, error=artifact.error or "Build failed")

        subdomain = f"{_slugify(bundle.business_slug)}-{bundle.environment}"
        return DeploymentOutcome(
            ok=True,
            target=self.name,
            url=f"https://{subdomain}.mock-deploy.internal",
            provider_ref=f"mock-{uuid.uuid4()}",
            detail={
                "provider": "mock",
                "note": "No real hosting is configured — this is a simulated deployment, not a live site.",
                "pages_deployed": sum(1 for path in artifact.files if path.endswith("index.html")),
                "files": sorted(artifact.files),
                "missing_information": artifact.missing_information,
            },
        )

    def get_status(self, provider_ref: str) -> DeploymentStatus:
        # A mock deploy is synchronous and already final by the time
        # deploy() returns — polling it always reports "ready" rather
        # than pretending there's an in-progress build to watch.
        return DeploymentStatus(state="ready", detail={"note": "Mock deployments settle immediately."})

    def rollback(self, provider_ref: str) -> DeploymentOutcome:
        return DeploymentOutcome(
            ok=True,
            target=self.name,
            provider_ref=f"mock-{uuid.uuid4()}",
            detail={"provider": "mock", "note": "Simulated rollback — no real hosting is configured."},
        )
