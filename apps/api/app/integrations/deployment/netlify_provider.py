"""
Real provider using Netlify's REST deploys API
(https://docs.netlify.com/api/get-started/#deploys). Selected via
`settings.deploy_provider == "netlify"`; constructing it without
`NETLIFY_API_TOKEN`/`NETLIFY_SITE_ID` set raises
`DeploymentProviderError` — same fail-loudly contract as the other real
adapters. Credentials come from `app.core.settings` only.

Uses the zip-upload deploy path (`PUT /sites/{site_id}/deploys` with
`Content-Type: application/zip`) — the simplest correct way to publish
a pre-built static file set (see `build.py`); Netlify's own build step
never runs, since there's nothing for it to compile.
"""

from __future__ import annotations

import io
import zipfile

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

_API_BASE = "https://api.netlify.com/api/v1"
_REQUEST_TIMEOUT_SECONDS = 30.0

# Netlify's deploy "state" values, normalized to this app's DeploymentStatus.state.
_STATE_MAP = {
    "new": "queued",
    "pending_review": "queued",
    "building": "building",
    "processing": "building",
    "uploading": "building",
    "uploaded": "building",
    "prepared": "building",
    "enqueued": "queued",
    "ready": "ready",
    "error": "error",
}


def _zip_files(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return buffer.getvalue()


class NetlifyProvider(DeploymentProvider):
    name = "netlify"

    def __init__(self, token: str, site_id: str | None) -> None:
        self._token = token
        self._site_id = site_id
        self.configured = bool(token and site_id)

    def _headers(self, content_type: str | None = None) -> dict:
        headers = {"Authorization": f"Bearer {self._token}"}
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def validate_config(self, project_config: dict) -> list[str]:
        site_id = (project_config or {}).get("site_id") or self._site_id
        return [] if site_id else ["No Netlify site id configured (set project_config.site_id or NETLIFY_SITE_ID)"]

    def deploy(self, bundle: DeploymentBundle, artifact: BuildArtifact) -> DeploymentOutcome:
        if not self.configured:
            return DeploymentOutcome(
                ok=False, target=self.name, error="Netlify is not configured — NETLIFY_API_TOKEN/NETLIFY_SITE_ID are not set"
            )
        if not artifact.ok:
            return DeploymentOutcome(ok=False, target=self.name, error=artifact.error or "Build failed")

        site_id = bundle.project_config.get("site_id") or self._site_id
        zip_bytes = _zip_files(artifact.files)

        try:
            response = httpx.put(
                f"{_API_BASE}/sites/{site_id}/deploys",
                headers=self._headers("application/zip"),
                content=zip_bytes,
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Request to Netlify failed: {exc}")

        if response.status_code >= 400:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Netlify returned {response.status_code}: {response.text[:500]}")

        try:
            data = response.json()
        except ValueError:
            return DeploymentOutcome(ok=False, target=self.name, error="Netlify returned a non-JSON response")

        url = data.get("ssl_url") or data.get("deploy_ssl_url") or data.get("url")
        return DeploymentOutcome(
            ok=True,
            target=self.name,
            url=url,
            provider_ref=data.get("id"),
            detail={"provider": "netlify", "state": data.get("state")},
        )

    def get_status(self, provider_ref: str) -> DeploymentStatus:
        if not self.configured:
            return DeploymentStatus(state="error", error="Netlify is not configured — NETLIFY_API_TOKEN/NETLIFY_SITE_ID are not set")
        try:
            response = httpx.get(
                f"{_API_BASE}/sites/{self._site_id}/deploys/{provider_ref}",
                headers=self._headers(),
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return DeploymentStatus(state="error", error=f"Request to Netlify failed: {exc}")

        if response.status_code >= 400:
            return DeploymentStatus(state="error", error=f"Netlify returned {response.status_code}: {response.text[:500]}")

        try:
            data = response.json()
        except ValueError:
            return DeploymentStatus(state="error", error="Netlify returned a non-JSON response")

        state = data.get("state", "")
        return DeploymentStatus(
            state=_STATE_MAP.get(state, "building"),
            url=data.get("ssl_url") or data.get("deploy_ssl_url") or data.get("url"),
            detail={"state": state},
        )

    def rollback(self, provider_ref: str) -> DeploymentOutcome:
        """Netlify keeps every deploy addressable — restoring an older
        one as the live site is a first-class API call, unlike Vercel/
        Cloudflare here, so this is real rather than falling back to
        the service layer's re-deploy path."""
        if not self.configured:
            return DeploymentOutcome(
                ok=False, target=self.name, error="Netlify is not configured — NETLIFY_API_TOKEN/NETLIFY_SITE_ID are not set"
            )
        try:
            response = httpx.post(
                f"{_API_BASE}/sites/{self._site_id}/deploys/{provider_ref}/restore",
                headers=self._headers(),
                timeout=_REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Request to Netlify failed: {exc}")

        if response.status_code >= 400:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Netlify returned {response.status_code}: {response.text[:500]}")

        try:
            data = response.json()
        except ValueError:
            data = {}
        url = data.get("ssl_url") or data.get("deploy_ssl_url") or data.get("url")
        return DeploymentOutcome(
            ok=True, target=self.name, url=url, provider_ref=data.get("id", provider_ref), detail={"provider": "netlify", "note": "Restored a prior deploy"}
        )


def get_netlify_provider() -> NetlifyProvider:
    if not settings.netlify_api_token or not settings.netlify_site_id:
        raise DeploymentProviderError("DEPLOY_PROVIDER is 'netlify' but NETLIFY_API_TOKEN/NETLIFY_SITE_ID are not configured.")
    return NetlifyProvider(settings.netlify_api_token, settings.netlify_site_id)
