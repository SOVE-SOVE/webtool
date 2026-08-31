"""
Maps a provider name (stored on `DiscoverySearch.provider`) to the
adapter that runs it — the one place `modules/discovery/service.py`
touches a concrete provider. Adding a provider is registering it here,
not changing the service.
"""

from app.core.settings import settings
from app.integrations.discovery.base import DiscoveryProvider
from app.integrations.discovery.brave_search_provider import BraveSearchDiscoveryProvider
from app.integrations.discovery.google_places_provider import GooglePlacesDiscoveryProvider

BRAVE_SEARCH = "brave_search"
GOOGLE_PLACES = "google_places"

_PROVIDERS: dict[str, DiscoveryProvider] = {
    BRAVE_SEARCH: BraveSearchDiscoveryProvider(),
    GOOGLE_PLACES: GooglePlacesDiscoveryProvider(),
}


class UnknownProviderError(ValueError):
    pass


def default_provider() -> str:
    """Google Places when it's configured — a real places source finds
    businesses (with or without a website) a web search can't. Otherwise
    Brave web search, which needs no extra credential."""
    return GOOGLE_PLACES if settings.google_places_api_key else BRAVE_SEARCH


# Kept for backwards compatibility with callers/tests that imported the
# constant. Prefer default_provider().
DEFAULT_PROVIDER = BRAVE_SEARCH


def get_provider(name: str) -> DiscoveryProvider:
    try:
        return _PROVIDERS[name]
    except KeyError:
        raise UnknownProviderError(f"Unknown discovery provider: {name!r}") from None


def available_providers() -> list[str]:
    return list(_PROVIDERS)
