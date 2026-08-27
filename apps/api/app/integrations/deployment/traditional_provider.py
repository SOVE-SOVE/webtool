"""
Real provider for "traditional hosting" — any shared/cPanel-style host
reachable over FTP, which is how the great majority of low-cost hosts
(the kind a $599-$1,299 small-business site typically lands on, per
docs/00_VISION.md's pricing) actually accept uploads. Uses Python's
stdlib `ftplib` deliberately, not a new dependency — FTPS (`FTP_TLS`)
is used whenever `TRADITIONAL_HOSTING_USE_TLS` is set, since plain FTP
sends credentials in the clear.

Selected via `settings.deploy_provider == "traditional"`; constructing
it without host/username/password/base_url set raises
`DeploymentProviderError`, same fail-loudly contract as the other real
adapters. There is no "deployment status" or native rollback API for
plain FTP — `get_status`/`rollback` are left unimplemented (base
default) and `modules/deployments/service.py` treats an upload's own
success/failure as final, falling back to its own redeploy-based
rollback like every other provider without a native one.
"""

from __future__ import annotations

import ftplib
import io

from app.core.settings import settings
from app.integrations.deployment.base import (
    BuildArtifact,
    DeploymentBundle,
    DeploymentOutcome,
    DeploymentProvider,
    DeploymentProviderError,
)


class TraditionalHostingProvider(DeploymentProvider):
    name = "traditional"

    def __init__(self, host: str, username: str, password: str, base_url: str, *, port: int = 21, remote_path: str = "/", use_tls: bool = False) -> None:
        self._host = host
        self._username = username
        self._password = password
        self._base_url = base_url.rstrip("/")
        self._port = port
        self._remote_path = remote_path or "/"
        self._use_tls = use_tls
        self.configured = bool(host and username and password and base_url)

    def _connect(self) -> ftplib.FTP:
        ftp_cls = ftplib.FTP_TLS if self._use_tls else ftplib.FTP
        ftp = ftp_cls()
        ftp.connect(self._host, self._port, timeout=30)
        ftp.login(self._username, self._password)
        if self._use_tls:
            ftp.prot_p()
        return ftp

    @staticmethod
    def _is_safe_path(path: str) -> bool:
        """Defense in depth: `build.py` already slugifies every page path,
        but this provider is the one place a `..`-containing path would
        turn into a real `ftp.cwd`/`mkd` walk on the customer's own
        hosting account, so it's worth a second, independent check here
        rather than trusting the caller never to regress it."""
        if not path or path.startswith("/"):
            return False
        return all(part not in ("", "..", ".") for part in path.split("/"))

    def _ensure_dir(self, ftp: ftplib.FTP, path: str) -> None:
        parts = [p for p in path.strip("/").split("/") if p]
        current = ""
        for part in parts:
            current = f"{current}/{part}"
            try:
                ftp.mkd(current)
            except ftplib.error_perm:
                pass  # already exists — not an error for this idempotent upload

    def deploy(self, bundle: DeploymentBundle, artifact: BuildArtifact) -> DeploymentOutcome:
        if not self.configured:
            return DeploymentOutcome(
                ok=False,
                target=self.name,
                error="Traditional hosting is not configured — host/username/password/base URL are not all set",
            )
        if not artifact.ok:
            return DeploymentOutcome(ok=False, target=self.name, error=artifact.error or "Build failed")

        try:
            ftp = self._connect()
        except (OSError, *ftplib.all_errors) as exc:
            return DeploymentOutcome(ok=False, target=self.name, error=f"Could not connect to {self._host}: {exc}")

        uploaded: list[str] = []
        try:
            ftp.cwd(self._remote_path)
            for path, content in artifact.files.items():
                if not self._is_safe_path(path):
                    return DeploymentOutcome(
                        ok=False,
                        target=self.name,
                        error=f"Refusing to upload unsafe build path: {path!r}",
                        detail={"uploaded": uploaded},
                    )
                remote_dir = "/".join(path.split("/")[:-1])
                if remote_dir:
                    self._ensure_dir(ftp, remote_dir)
                    ftp.cwd(f"{self._remote_path.rstrip('/')}/{remote_dir}")
                else:
                    ftp.cwd(self._remote_path)
                filename = path.split("/")[-1]
                ftp.storbinary(f"STOR {filename}", io.BytesIO(content.encode("utf-8")))
                uploaded.append(path)
        except ftplib.all_errors as exc:
            return DeploymentOutcome(
                ok=False,
                target=self.name,
                error=f"Upload failed after {len(uploaded)}/{len(artifact.files)} file(s): {exc}",
                detail={"uploaded": uploaded},
            )
        finally:
            try:
                ftp.quit()
            except ftplib.all_errors:
                ftp.close()

        return DeploymentOutcome(
            ok=True,
            target=self.name,
            url=self._base_url,
            detail={"provider": "traditional", "protocol": "ftps" if self._use_tls else "ftp", "files_uploaded": len(uploaded)},
        )


def get_traditional_provider() -> TraditionalHostingProvider:
    missing = [
        name
        for name, value in [
            ("TRADITIONAL_HOSTING_HOST", settings.traditional_hosting_host),
            ("TRADITIONAL_HOSTING_USERNAME", settings.traditional_hosting_username),
            ("TRADITIONAL_HOSTING_PASSWORD", settings.traditional_hosting_password),
            ("TRADITIONAL_HOSTING_BASE_URL", settings.traditional_hosting_base_url),
        ]
        if not value
    ]
    if missing:
        raise DeploymentProviderError(f"DEPLOY_PROVIDER is 'traditional' but {', '.join(missing)} {'is' if len(missing) == 1 else 'are'} not configured.")
    return TraditionalHostingProvider(
        settings.traditional_hosting_host,
        settings.traditional_hosting_username,
        settings.traditional_hosting_password,
        settings.traditional_hosting_base_url,
        port=settings.traditional_hosting_port,
        remote_path=settings.traditional_hosting_remote_path,
        use_tls=settings.traditional_hosting_use_tls,
    )
