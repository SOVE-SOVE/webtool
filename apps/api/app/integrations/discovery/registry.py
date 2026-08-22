"""
Maps a provider name (stored on `DiscoverySearch.provider`) to the
adapter that runs it — the one place `modules/discovery/service.py`
touches a concrete provider. Adding a second provider later is
registering it here, not changing the service.
"""

from app.integrations.discovery.base import DiscoveryProvider
from app.integrations.discovery.brave_search_provider import BraveSearchDiscoveryProvider

DEFAULT_PROVIDER = "brave_search"

_PROVIDERS: dict[str, DiscoveryProvider] = {
    "brave_search": BraveSearchDiscoveryProvider(),
}


class UnknownProviderError(ValueError):
    pass


def get_provider(name: str) -> DiscoveryProvider:
    try:
        return _PROVIDERS[name]
    except KeyError:
        raise UnknownProviderError(f"Unknown discovery provider: {name!r}") from None


def available_providers() -> list[str]:
    return list(_PROVIDERS)
