"""
Real provider using Cloudflare Pages' direct-upload deployments API
(https://developers.cloudflare.com/api/operations/pages-deployment-create-deployment).
Selected via `settings.deploy_provider == "cloudflare"`; constructing
it without `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/
`CLOUDFLARE_PAGES_PROJECT` set raises `DeploymentProviderError`, same
fail-loudly contract as the other real adapters.

Cloudflare's direct-upload protocol is a multipart/form-data request
carrying each build file as its own part, keyed by its file path. Any
request Cloudflare rejects (a manifest/shape mismatch included) comes
back as an ordinary non-2xx response, handled the same as every other
adapter here — a clean `DeploymentOutcome(ok=False, error=...)`, never
a crash and never a pretended success.
"""

from __future__ import annotations

import httpx

from app.core.settings import settings
from app.integrations.deployment.base import (
    BuildArtifact,
    DeploymentBundle,
    DeploymentOutcome,
    DeploymentProvider,
    DeploymentProviderError,
    DeploymentStatus,
)

_API_BASE = "https://api.cloudflare.com/client/v4"
_REQUEST_TIMEOUT_SECONDS = 30.0


class CloudflareProvider(DeploymentProvider):
    name = "cloudflare"

    def __init__(self, api_token: str, account_id: str, project_name: str) -> None:
        self._api_token = api_token
        self._account_id = account_id
        self._project_name = project_name
        self.configured = bool(api_token and account_id and project_name)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_token}"}

    def validate_config(self, project_config: dict) -> list[str]:
        project_name = (project_config or {}).get("project_name") or self._project_name
        return [] if project_name else ["No Cloudflare Pages project configured (set project_config.project_name or CLOUDFLARE_PAGES_PROJECT)"]

    def deploy(self, bundle: DeploymentBundle, artifact: BuildArtifact) -> DeploymentOutcome:
        if not self.configured:
            return DeploymentOutcome(
                ok=False,
                target=self.name,
                error="Cloudflare is not configured — CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_PAGES_PROJECT are not set",
            )
        if not artifact.ok:
            return DeploymentOutcome(ok=False, target=self.name, error=artifact.error or "Build failed")

        project_name = bundle.project_config.get("project_name") or self._project_name
        files = {
            f"files[{path}]": (path, content, "text/html" if path.endswith(".html") else "text/css")
            for path, content in artifact.files.items()
        }
        data = {"branch": "production" if bundle.environment == "production" else "preview"}

        try:
            response = httpx.post(
                f"{_API_BASE}/accounts/{self._account_id}/pages/projects/{project_name}/deployments",
                headers=self._headers(),
                data=data,
                files=files,
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Request to Cloudflare failed: {exc}")

        if response.status_code >= 400:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Cloudflare returned {response.status_code}: {response.text[:500]}")

        try:
            payload = response.json()
        except ValueError:
            return DeploymentOutcome(ok=False, target=self.name, error="Cloudflare returned a non-JSON response")

        if not payload.get("success", False):
            errors = "; ".join(str(e.get("message", e)) for e in payload.get("errors", []))
            return DeploymentOutcome(ok=False, target=self.name, error=errors or "Cloudflare reported the deployment as unsuccessful")

        result = payload.get("result", {})
        return DeploymentOutcome(
            ok=True,
            target=self.name,
            url=result.get("url"),
            provider_ref=result.get("id"),
            detail={"provider": "cloudflare", "stage": (result.get("latest_stage") or {}).get("name")},
        )

    def get_status(self, provider_ref: str) -> DeploymentStatus:
        if not self.configured:
            return DeploymentStatus(state="error", error="Cloudflare is not configured")
        try:
            response = httpx.get(
                f"{_API_BASE}/accounts/{self._account_id}/pages/projects/{self._project_name}/deployments/{provider_ref}",
                headers=self._headers(),
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return DeploymentStatus(state="error", error=f"Request to Cloudflare failed: {exc}")

        if response.status_code >= 400:
            return DeploymentStatus(state="error", error=f"Cloudflare returned {response.status_code}: {response.text[:500]}")

        try:
            payload = response.json()
        except ValueError:
            return DeploymentStatus(state="error", error="Cloudflare returned a non-JSON response")

        result = payload.get("result", {}) if payload.get("success") else {}
        stage = (result.get("latest_stage") or {})
        stage_status = stage.get("status", "")
        state = {"success": "ready", "failure": "error", "active": "building", "idle": "queued"}.get(stage_status, "building")
        return DeploymentStatus(state=state, url=result.get("url"), detail={"stage": stage.get("name"), "status": stage_status})


def get_cloudflare_provider() -> CloudflareProvider:
    if not (settings.cloudflare_api_token and settings.cloudflare_account_id and settings.cloudflare_pages_project):
        raise DeploymentProviderError(
            "DEPLOY_PROVIDER is 'cloudflare' but CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_PAGES_PROJECT are not all configured."
        )
    return CloudflareProvider(settings.cloudflare_api_token, settings.cloudflare_account_id, settings.cloudflare_pages_project)
