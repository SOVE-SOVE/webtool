"""
Phase 1 of Instagram Discovery (docs/05_DECISIONS.md) — parses
operator-provided CSV text into `NormalizedBusinessResult` rows using
the same normalized shape every other `DiscoveryProvider` produces, so
the existing ingest/dedup/review/score/CRM-import pipeline in
modules/discovery/service.py needs no special-casing to handle them.

Deliberately not a `DiscoveryProvider` itself: there is no live
`discover()` call to make (see docs/05_DECISIONS.md on why Meta has no
"search Instagram businesses by location" API) — this only turns text
the operator already has into the same normalized shape a provider
would produce, and modules/discovery/service.py's
`import_instagram_candidates` hands the result straight to the existing
`_ingest_page`.

Pure, no DB access, easily unit-tested — see tests/test_instagram_import.py.
"""

import csv
import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from app.integrations.discovery.base import (
    INSTAGRAM_NO_OWNED_SITE_STATUSES,
    InstagramWebsiteStatus,
    LocationConfidence,
    NormalizedBusinessResult,
    WebsiteStatus,
)

# A sanity ceiling on one import, not a business requirement — keeps one
# bad paste from creating thousands of rows in a single request. See
# modules/discovery/service.py's import_instagram_candidates.
MAX_ROWS_PER_IMPORT = 500

REQUIRED_COLUMNS_HINT = "name (or instagram_handle)"

_HANDLE_STRIP_RE = re.compile(r"^@")

_STATUS_ALIASES: dict[str, InstagramWebsiteStatus] = {
    "no_website": InstagramWebsiteStatus.NO_WEBSITE,
    "no website": InstagramWebsiteStatus.NO_WEBSITE,
    "none": InstagramWebsiteStatus.NO_WEBSITE,
    "link_in_bio_only": InstagramWebsiteStatus.LINK_IN_BIO_ONLY,
    "link in bio": InstagramWebsiteStatus.LINK_IN_BIO_ONLY,
    "link in bio only": InstagramWebsiteStatus.LINK_IN_BIO_ONLY,
    "linktree": InstagramWebsiteStatus.LINK_IN_BIO_ONLY,
    "instagram_shop_only": InstagramWebsiteStatus.INSTAGRAM_SHOP_ONLY,
    "instagram shop": InstagramWebsiteStatus.INSTAGRAM_SHOP_ONLY,
    "shop": InstagramWebsiteStatus.INSTAGRAM_SHOP_ONLY,
    "proper_website": InstagramWebsiteStatus.PROPER_WEBSITE,
    "website": InstagramWebsiteStatus.PROPER_WEBSITE,
    "has website": InstagramWebsiteStatus.PROPER_WEBSITE,
    "unknown_needs_review": InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW,
    "unknown": InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW,
    "needs review": InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW,
    "": InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW,
}

_CONFIDENCE_ALIASES: dict[str, LocationConfidence] = {
    "confirmed": LocationConfidence.CONFIRMED,
    "approximate": LocationConfidence.APPROXIMATE,
    "approx": LocationConfidence.APPROXIMATE,
    "unknown": LocationConfidence.UNKNOWN,
    "": LocationConfidence.UNKNOWN,
}

_DATE_FORMATS = ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%d/%m/%Y")


@dataclass
class InstagramRowError:
    row_number: int  # 1-based, matching what a spreadsheet shows (row 1 is the header)
    reason: str


@dataclass
class InstagramCsvParseResult:
    results: list[NormalizedBusinessResult]
    errors: list[InstagramRowError]
    truncated: bool = False


def _normalize_header(header: str) -> str:
    return header.strip().lower().replace(" ", "_").replace("-", "_")


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _row_value(row: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = row.get(key)
        if value is not None and value.strip():
            return value
    return None


def _generic_status_for(status: InstagramWebsiteStatus, has_url: bool) -> WebsiteStatus:
    """Maps the 5-state Instagram classification down to the generic
    tri-state every existing map/filter/scoring path understands — see
    InstagramWebsiteStatus's docstring for why the two are separate."""
    if status == InstagramWebsiteStatus.PROPER_WEBSITE and has_url:
        return WebsiteStatus.FOUND
    if status in INSTAGRAM_NO_OWNED_SITE_STATUSES:
        return WebsiteStatus.NONE
    return WebsiteStatus.UNKNOWN


def _parse_status(raw: str | None) -> InstagramWebsiteStatus:
    return _STATUS_ALIASES.get((raw or "").strip().lower(), InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW)


def _parse_confidence(raw: str | None) -> LocationConfidence:
    return _CONFIDENCE_ALIASES.get((raw or "").strip().lower(), LocationConfidence.UNKNOWN)


def _parse_int(raw: str | None) -> int | None:
    if not raw or not raw.strip():
        return None
    try:
        return int(float(raw.strip().replace(",", "")))
    except ValueError:
        return None


def _parse_float(raw: str | None) -> float | None:
    if not raw or not raw.strip():
        return None
    try:
        return float(raw.strip())
    except ValueError:
        return None


def _parse_datetime(raw: str | None) -> datetime | None:
    if not raw or not raw.strip():
        return None
    text = raw.strip()
    for fmt in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_instagram_csv(csv_text: str) -> InstagramCsvParseResult:
    """
    Parses operator-provided CSV text into normalized candidates, using
    Python's stdlib `csv` module (RFC 4180 quoting) rather than a
    hand-rolled split — a business name like "Smith, Jones & Co" in a
    quoted field is handled correctly. A row missing both `name` and
    `instagram_handle` is skipped with a reason rather than failing the
    whole import, same "a bad selection shouldn't block the rest"
    philosophy as discovery/service.py's `bulk_approve`. Header matching
    is case/whitespace/hyphen-insensitive and tolerates a few common
    column-name synonyms (see `_row_value` call sites below).
    """
    reader = csv.reader(io.StringIO(csv_text))
    try:
        header_row = next(reader)
    except StopIteration:
        return InstagramCsvParseResult(results=[], errors=[])
    headers = [_normalize_header(h) for h in header_row]

    results: list[NormalizedBusinessResult] = []
    errors: list[InstagramRowError] = []
    truncated = False

    for i, raw_row in enumerate(reader, start=2):  # row 1 is the header
        if not any(cell.strip() for cell in raw_row):
            continue  # a blank line, not a real row
        if len(results) >= MAX_ROWS_PER_IMPORT:
            truncated = True
            break
        row = {headers[j]: raw_row[j] for j in range(min(len(headers), len(raw_row)))}

        name = _clean(_row_value(row, "name", "business_name"))
        handle = _clean(_row_value(row, "instagram_handle", "handle", "username"))
        if handle:
            handle = _HANDLE_STRIP_RE.sub("", handle)
        if not name and not handle:
            errors.append(
                InstagramRowError(
                    row_number=i, reason=f"Missing both name and handle — need at least {REQUIRED_COLUMNS_HINT}"
                )
            )
            continue

        website_url = _clean(_row_value(row, "website_url", "website"))
        status = _parse_status(_row_value(row, "website_status", "instagram_website_status"))
        generic_status = _generic_status_for(status, has_url=bool(website_url))
        if generic_status != WebsiteStatus.FOUND:
            # Never claim a website exists without a URL to back it up —
            # a "proper_website" row with no URL column filled in falls
            # back to UNKNOWN, not a confident FOUND.
            website_url = None

        address = _clean(_row_value(row, "address"))
        suburb = _clean(_row_value(row, "suburb", "city"))
        state = _clean(_row_value(row, "state"))
        # Optional — an operator who already has real coordinates (e.g.
        # copied from a location tag or a maps app while visiting) can
        # supply them directly; there's no geocoding step in Phase 1 (see
        # the module docstring), so a row with only a text address never
        # gets a map pin. Only accepted as a pair — one without the other
        # is a malformed coordinate, not a hint to guess the missing half.
        latitude = _parse_float(_row_value(row, "latitude", "lat"))
        longitude = _parse_float(_row_value(row, "longitude", "lng", "lon"))
        if latitude is None or longitude is None:
            latitude = longitude = None

        confidence_raw = _row_value(row, "location_confidence")
        if confidence_raw:
            location_confidence = _parse_confidence(confidence_raw)
        elif latitude is not None:
            location_confidence = LocationConfidence.CONFIRMED
        elif address or suburb or state:
            location_confidence = LocationConfidence.APPROXIMATE
        else:
            location_confidence = None

        results.append(
            NormalizedBusinessResult(
                name=(name or handle or "")[:255],
                website_url=website_url,
                website_status=generic_status,
                phone=_clean(_row_value(row, "phone")),
                email=_clean(_row_value(row, "email")),
                address=address,
                suburb=suburb,
                state=state,
                postcode=_clean(_row_value(row, "postcode", "zip")),
                country=_clean(_row_value(row, "country")),
                latitude=latitude,
                longitude=longitude,
                business_category=_clean(_row_value(row, "category", "business_category")),
                social_links=[],
                source_external_id=f"instagram:{handle}" if handle else None,
                raw_snippet=_clean(_row_value(row, "notes")),
                location_confidence=location_confidence,
                instagram_handle=handle,
                instagram_profile_url=_clean(_row_value(row, "instagram_profile_url", "profile_url"))
                or (f"https://instagram.com/{handle}" if handle else None),
                instagram_profile_image_url=_clean(_row_value(row, "profile_image_url", "profile_image")),
                instagram_bio=_clean(_row_value(row, "bio")),
                instagram_follower_count=_parse_int(_row_value(row, "follower_count", "followers")),
                instagram_last_post_at=_parse_datetime(_row_value(row, "last_post_date", "last_post_at")),
                instagram_bio_link_url=_clean(_row_value(row, "bio_link_url", "bio_link", "link_in_bio_url")),
                instagram_website_status=status,
            )
        )

    return InstagramCsvParseResult(results=results, errors=errors, truncated=truncated)
