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
DETAILS_URL = "https://places.googleapis.com/v1/places"
REQUEST_TIMEOUT_S = 10.0
# Place Details field mask for review intelligence — exactly what
# review_intelligence needs, nothing more (billed by field tier, same
# reasoning as FIELD_MASK below). Google returns at most 5 individual
# reviews per place (its own choice of which 5 — "most relevant", not
# guaranteed to be the most recent), and never exposes a full historical
# review list or a star-by-star rating breakdown through this API. Every
# caller of get_place_details must treat `rating`/`user_rating_count` as
# the only reliable aggregate figures, and `reviews` as a small, possibly
# non-recent sample — never the business's complete review history.
DETAILS_FIELD_MASK = ",".join(
    [
        "id",
        "rating",
        "userRatingCount",
        "reviews.rating",
        "reviews.text",
        "reviews.originalText",
        "reviews.publishTime",
        "reviews.relativePublishTimeDescription",
        "reviews.authorAttribution.displayName",
    ]
)
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


@dataclass
class PlaceReview:
    rating: int | None = None
    text: str | None = None
    author_name: str | None = None
    # Real timestamp from Google (RFC3339), when it gave us one — never
    # derived/guessed from relative_time_description.
    published_at: str | None = None
    # Google's own fuzzy phrasing (e.g. "3 weeks ago") — kept alongside
    # published_at only for display when a caller wants Google's own
    # wording; review_intelligence computes everything off published_at.
    relative_time_description: str | None = None


@dataclass
class PlaceDetails:
    place_id: str
    rating: float | None = None
    user_rating_count: int | None = None
    # Up to 5 entries — see DETAILS_FIELD_MASK's docstring on why this is
    # never the complete review history.
    reviews: list[PlaceReview] = field(default_factory=list)


def _parse_review(raw: dict) -> PlaceReview:
    text_obj = raw.get("text") or raw.get("originalText") or {}
    return PlaceReview(
        rating=raw.get("rating"),
        text=text_obj.get("text") or None,
        author_name=(raw.get("authorAttribution") or {}).get("displayName") or None,
        published_at=raw.get("publishTime") or None,
        relative_time_description=raw.get("relativePublishTimeDescription") or None,
    )


def get_place_details(place_id: str) -> PlaceDetails | None:
    """One Place Details request for review intelligence. Returns None
    (not an error) when the key is unset, `place_id` is blank, or the
    call fails — the caller (review_intelligence) treats that as "Google
    is currently unavailable", never as "this business has no reviews"."""
    if not settings.google_places_api_key or not place_id:
        return None

    try:
        response = httpx.get(
            f"{DETAILS_URL}/{place_id}",
            headers={
                "X-Goog-Api-Key": settings.google_places_api_key,
                "X-Goog-FieldMask": DETAILS_FIELD_MASK,
            },
            timeout=REQUEST_TIMEOUT_S,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Google Place Details request failed for place_id %r: %s", place_id, exc)
        return None

    return PlaceDetails(
        place_id=payload.get("id") or place_id,
        rating=payload.get("rating"),
        user_rating_count=payload.get("userRatingCount"),
        reviews=[_parse_review(r) for r in (payload.get("reviews") or [])],
    )
