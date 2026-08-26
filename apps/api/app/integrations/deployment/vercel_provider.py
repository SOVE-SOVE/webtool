"""
Real provider using Vercel's REST deployments API
(https://vercel.com/docs/rest-api/endpoints/deployments). Selected via
`settings.deploy_provider == "vercel"`; constructing it without
`VERCEL_API_TOKEN` set raises `DeploymentProviderError` — same "fail
loudly rather than silently falling back to mock" contract as
`ResendEmailProvider`/`GoogleCalendarProvider`. The token, project
name, and optional team id all come from `app.core.settings` (itself
populated from the process environment / `.env`) — never a literal in
this file.

Every build file is small, pre-rendered static HTML/CSS (see
`build.py`), so this uses the deployment API's inline-file-content path
(`files: [{file, data}]`) rather than the separate content-addressed
upload endpoint meant for large binary assets — simpler, and correct
for what this app ever builds.
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

_API_BASE = "https://api.vercel.com"
_REQUEST_TIMEOUT_SECONDS = 30.0

# Vercel's readyState values, normalized to this app's DeploymentStatus.state.
_STATE_MAP = {
    "QUEUED": "queued",
    "INITIALIZING": "queued",
    "BUILDING": "building",
    "READY": "ready",
    "ERROR": "error",
    "CANCELED": "error",
}


class VercelProvider(DeploymentProvider):
    name = "vercel"

    def __init__(self, token: str, team_id: str | None = None) -> None:
        self._token = token
        self._team_id = team_id
        self.configured = bool(token)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

    def _params(self) -> dict:
        return {"teamId": self._team_id} if self._team_id else {}

    def validate_config(self, project_config: dict) -> list[str]:
        issues = []
        if not (project_config or {}).get("project_name") and not settings.vercel_project_name:
            issues.append("No Vercel project name configured (set project_config.project_name or VERCEL_PROJECT_NAME)")
        return issues

    def deploy(self, bundle: DeploymentBundle, artifact: BuildArtifact) -> DeploymentOutcome:
        if not self.configured:
            return DeploymentOutcome(ok=False, target=self.name, error="Vercel is not configured — VERCEL_API_TOKEN is not set")
        if not artifact.ok:
            return DeploymentOutcome(ok=False, target=self.name, error=artifact.error or "Build failed")

        project_name = bundle.project_config.get("project_name") or settings.vercel_project_name
        if not project_name:
            return DeploymentOutcome(ok=False, target=self.name, error="No Vercel project name configured")

        payload = {
            "name": project_name,
            "target": "production" if bundle.environment == "production" else "preview",
            "files": [{"file": path, "data": content} for path, content in artifact.files.items()],
            "projectSettings": {"framework": None},
        }
        if bundle.env_vars:
            payload["env"] = bundle.env_vars

        try:
            response = httpx.post(
                f"{_API_BASE}/v13/deployments",
                params=self._params(),
                headers=self._headers(),
                json=payload,
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Request to Vercel failed: {exc}")

        if response.status_code >= 400:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Vercel returned {response.status_code}: {response.text[:500]}")

        try:
            data = response.json()
        except ValueError:
            return DeploymentOutcome(ok=False, target=self.name, error="Vercel returned a non-JSON response")

        url = data.get("url")
        return DeploymentOutcome(
            ok=True,
            target=self.name,
            url=f"https://{url}" if url and not url.startswith("http") else url,
            provider_ref=data.get("id") or data.get("uid"),
            detail={"provider": "vercel", "readyState": data.get("readyState")},
        )

    def get_status(self, provider_ref: str) -> DeploymentStatus:
        if not self.configured:
            return DeploymentStatus(state="error", error="Vercel is not configured — VERCEL_API_TOKEN is not set")
        try:
            response = httpx.get(
                f"{_API_BASE}/v13/deployments/{provider_ref}",
                params=self._params(),
                headers=self._headers(),
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return DeploymentStatus(state="error", error=f"Request to Vercel failed: {exc}")

        if response.status_code >= 400:
            return DeploymentStatus(state="error", error=f"Vercel returned {response.status_code}: {response.text[:500]}")

        try:
            data = response.json()
        except ValueError:
            return DeploymentStatus(state="error", error="Vercel returned a non-JSON response")

        ready_state = data.get("readyState", "")
        url = data.get("url")
        return DeploymentStatus(
            state=_STATE_MAP.get(ready_state, "building"),
            url=f"https://{url}" if url and not url.startswith("http") else url,
            detail={"readyState": ready_state},
        )


def get_vercel_provider() -> VercelProvider:
    if not settings.vercel_api_token:
        raise DeploymentProviderError("DEPLOY_PROVIDER is 'vercel' but VERCEL_API_TOKEN is not configured.")
    return VercelProvider(settings.vercel_api_token, settings.vercel_team_id or None)
