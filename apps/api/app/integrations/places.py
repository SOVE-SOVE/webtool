"""
Google Places API (New) — Text Search. A real business/places data
source (structured name / address / phone / category / coordinates /
website), unlike a web search which only returns pages.

Same "degrade, don't explode" shape as integrations/search.py: returns
None when `GOOGLE_PLACES_API_KEY` is unset or the request fails, so a
caller can fall back to another provider rather than the whole request
erroring. Never called from the browser — this runs server-side only,
and the key never leaves the backend.
"""

from dataclasses import dataclass, field

import httpx

from app.core.logging import logger
from app.core.settings import settings

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
REQUEST_TIMEOUT_S = 10.0
# Exactly the fields we map — the API bills by field tier, so we don't
# ask for more than integrations/discovery/google_places_provider needs.
FIELD_MASK = ",".join(
    [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.addressComponents",
        "places.location",
        "places.nationalPhoneNumber",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.primaryTypeDisplayName",
        "places.types",
        "nextPageToken",
    ]
)


@dataclass
class PlaceResult:
    place_id: str
    name: str
    formatted_address: str | None = None
    suburb: str | None = None
    state: str | None = None
    postcode: str | None = None
    country: str | None = None
    phone: str | None = None
    website_url: str | None = None
    # True if the API returned a place record without a websiteUri — a
    # curated directory's silence on a website is meaningful (unlike a
    # web search's). Callers turn this into website_status NONE.
    website_absent: bool = True
    category: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    types: list[str] = field(default_factory=list)


_COMPONENT_KEYS = {
    "locality": ("suburb", "long"),
    "postal_town": ("suburb", "long"),
    "administrative_area_level_1": ("state", "short"),
    "postal_code": ("postcode", "long"),
    "country": ("country", "long"),
}


def _parse_components(components: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for comp in components or []:
        for t in comp.get("types", []):
            mapping = _COMPONENT_KEYS.get(t)
            if not mapping:
                continue
            key, which = mapping
            if key in out:
                continue
            value = comp.get("shortText" if which == "short" else "longText") or comp.get("longText")
            if value:
                out[key] = value
    return out


def _parse_place(raw: dict) -> PlaceResult | None:
    place_id = raw.get("id")
    name = (raw.get("displayName") or {}).get("text")
    if not place_id or not name:
        return None
    comps = _parse_components(raw.get("addressComponents") or [])
    loc = raw.get("location") or {}
    website = raw.get("websiteUri") or None
    category = (raw.get("primaryTypeDisplayName") or {}).get("text")
    if not category:
        types = raw.get("types") or []
        category = types[0].replace("_", " ").strip().capitalize() if types else None
    return PlaceResult(
        place_id=place_id,
        name=name,
        formatted_address=raw.get("formattedAddress") or None,
        suburb=comps.get("suburb"),
        state=comps.get("state"),
        postcode=comps.get("postcode"),
        country=comps.get("country"),
        phone=raw.get("nationalPhoneNumber") or raw.get("internationalPhoneNumber") or None,
        website_url=website,
        website_absent=website is None,
        category=category,
        latitude=loc.get("latitude"),
        longitude=loc.get("longitude"),
        types=list(raw.get("types") or []),
    )


@dataclass
class PlacesPage:
    results: list[PlaceResult]
    next_page_token: str | None = None


def text_search(query: str, *, page_size: int = 20, page_token: str | None = None) -> PlacesPage | None:
    """One Text Search request. Returns None (not an error) when the key
    is unset or the call fails."""
    if not settings.google_places_api_key:
        return None

    body: dict = {"textQuery": query, "pageSize": max(1, min(page_size, 20)), "languageCode": "en"}
    if page_token:
        body["pageToken"] = page_token
    try:
        response = httpx.post(
            SEARCH_URL,
            json=body,
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": settings.google_places_api_key,
                "X-Goog-FieldMask": FIELD_MASK,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Google Places request failed for query %r: %s", query, exc)
        return None

    parsed = [p for p in (_parse_place(raw) for raw in payload.get("places", [])) if p is not None]
    return PlacesPage(results=parsed, next_page_token=payload.get("nextPageToken"))
