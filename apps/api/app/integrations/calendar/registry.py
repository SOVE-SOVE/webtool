"""
Maps a provider name (settings.calendar_provider, or an explicit
override) to the adapter that runs it — the one place
modules/meetings/service.py touches a concrete calendar provider.
Adding a real second provider later (Outlook, CalDAV) is registering
it here, not changing the service. Same shape as
app/integrations/discovery/registry.py.
"""

from app.core.settings import settings
from app.integrations.calendar.base import CalendarProvider
from app.integrations.calendar.google_provider import GoogleCalendarProvider
from app.integrations.calendar.mock_provider import MockCalendarProvider

DEFAULT_PROVIDER = "google"

_PROVIDERS: dict[str, CalendarProvider] = {
    "google": GoogleCalendarProvider(),
    "mock": MockCalendarProvider(),
}


class UnknownCalendarProviderError(ValueError):
    pass


def get_provider(name: str | None = None) -> CalendarProvider:
    key = name or settings.calendar_provider
    try:
        return _PROVIDERS[key]
    except KeyError:
        raise UnknownCalendarProviderError(f"Unknown calendar provider: {key!r}") from None


def available_providers() -> list[str]:
    return list(_PROVIDERS)
