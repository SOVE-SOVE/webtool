"""
The provider adapter contract for website deployment (roadmap M6, and
the phase-6-part-2 adapter-architecture pass). `modules/deployments/
service.py` codes only against this interface, never against a
concrete provider — same "design around provider adapters; do not
hard-code a single provider into the business logic" convention as
`app/integrations/calendar/base.py` and `app/integrations/discovery/
base.py`.

A deployment has four phases, each represented explicitly so a real
host's own lifecycle (queue a build, poll it, get a URL, roll back to
an earlier build) can be modeled instead of flattened into one
synchronous call:

    validate_config -> build -> deploy -> (get_status)* -> (rollback)?

No provider implementation may ever fabricate a result — a failure
(missing credentials, a rejected request, an unreachable host) must
come back as `ok=False` with a real `error`, never as a success with
invented data. See `mock_provider.py` for why that matters even for
the one provider that makes no network call at all.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class DeploymentBundle:
    """
    Everything a provider needs to build and publish one website
    version. `config` is the generated site (`Website.config` —
    `{navigation, footer, pages: [...]}`, the same shape
    `packages/site-templates` renders). `project_config` is
    provider-facing project settings (custom domain, build/output
    options) — deliberately separate from `config` so a provider never
    has to reach into site content to find its own settings.
    `env_vars` are build/runtime environment variables for the target
    site (e.g. a forms endpoint, an analytics id) — never credentials
    for the *provider itself*, which come from `app.core.settings` /
    the process environment on the adapter side, not from caller input.
    """

    business_slug: str
    environment: str
    config: dict
    project_config: dict = field(default_factory=dict)
    env_vars: dict[str, str] = field(default_factory=dict)


@dataclass
class BuildArtifact:
    """
    The output of the build phase: a static, deployable file set.
    `files` maps a repo-relative path (e.g. "index.html",
    "about/index.html", "assets/styles.css") to its full text content.
    Every real provider deploys exactly these files — none of them
    invent additional pages or content beyond what `build_static_site`
    (see build.py) assembled from the bundle's own config.
    """

    ok: bool
    files: dict[str, str] = field(default_factory=dict)
    entry_page: str | None = None  # the file to treat as "/" (usually "index.html")
    error: str | None = None
    missing_information: list[str] = field(default_factory=list)


@dataclass
class DeploymentOutcome:
    """
    The result of the deploy phase (or of a provider-native rollback,
    which returns the same shape). `provider_ref` is the provider's own
    id for this deployment — opaque to this app, round-tripped back
    into `get_status`/`rollback` so a real provider's async build can be
    polled and a specific prior build can be restored.
    """

    ok: bool
    target: str
    url: str | None = None
    provider_ref: str | None = None
    detail: dict = field(default_factory=dict)
    error: str | None = None


@dataclass
class DeploymentStatus:
    """
    A point-in-time read of a deployment already submitted to a
    provider — `get_status` never mutates anything, it only reports.
    `state` is normalized across providers to one of: "queued",
    "building", "ready", "error" — `modules/deployments/service.py`
    maps this onto its own pending/running/success/failed column, it
    never stores a provider's raw status string directly.
    """

    state: str
    url: str | None = None
    detail: dict = field(default_factory=dict)
    error: str | None = None


class DeploymentProviderError(RuntimeError):
    """Raised by a provider constructor/factory for a misconfiguration
    (missing credential, unknown provider name) — never raised mid-
    deploy; a failure once a deployment is underway is always reported
    as a DeploymentOutcome/DeploymentStatus with ok=False, not an
    exception, so one bad provider response can't 500 the request."""


class DeploymentProvider(ABC):
    """Interface every deployment provider implements."""

    name: str = "base"

    #: Whether this provider was constructed with usable credentials.
    #: Real providers set this in __init__; the mock provider (which
    #: needs none) is always configured. Checked by the registry/service
    #: layer before ever calling deploy(), so "selected but not set up"
    #: fails with one clear message instead of a confusing request error.
    configured: bool = True

    def validate_config(self, project_config: dict) -> list[str]:
        """
        Provider-specific project configuration problems (e.g. a
        provider that requires a project/site id on file). Returns the
        list of issues found — empty means the config is usable. Base
        implementation requires nothing extra.
        """
        return []

    def build(self, bundle: DeploymentBundle) -> BuildArtifact:
        """
        Produces the static file set to publish. The default
        implementation (shared by every real provider, and available to
        the mock provider too) is `build.build_static_site` — a
        provider only needs to override this if it has its own build
        pipeline (e.g. shelling out to a framework build command),
        which none of the providers here do.
        """
        from app.integrations.deployment.build import build_static_site

        return build_static_site(bundle)

    @abstractmethod
    def deploy(self, bundle: DeploymentBundle, artifact: BuildArtifact) -> DeploymentOutcome:
        """Publishes `artifact` and returns the outcome, including a
        reachable URL on success. Must never raise for an ordinary
        failure (bad credentials, rejected request, network error) —
        those come back as `DeploymentOutcome(ok=False, error=...)`."""
        raise NotImplementedError

    def get_status(self, provider_ref: str) -> DeploymentStatus:
        """
        Polls the provider for a previously submitted deployment's
        current state — the "monitor deployment" step. Providers whose
        deploy() call is already synchronous/final (mock, and every
        adapter here today, since none of them poll an async build) can
        rely on this default, which reports the outcome as already
        settled; a provider with a genuinely async build pipeline would
        override this to make a real status call.
        """
        raise NotImplementedError(f"{self.name} does not support status polling")

    def rollback(self, provider_ref: str) -> DeploymentOutcome:
        """
        Provider-native rollback (e.g. "promote this earlier deployment
        to production") for providers that keep their own deployment
        history. Not every provider supports this — `modules/
        deployments/service.py` falls back to re-running `deploy()` with
        the target version's own bundle when it doesn't, so rollback
        always works, just not always via the provider's own API.
        """
        raise NotImplementedError(f"{self.name} does not support native rollback")
