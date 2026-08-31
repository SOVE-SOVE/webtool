"""
Duplicate detection for discovered businesses — deliberately simple and
deterministic (normalized exact match), not fuzzy/ML matching, so a
match is always explainable. Two matches are checked, in order of
strength:

1. `website_url` or `phone`, normalized — a strong signal on its own.
2. Normalized name + full street address — a strong pair once a places-
   style provider actually gives a street address (a plain web search
   doesn't). Two businesses at the same address with the same name are
   the same business; two with the same name at *different* addresses
   are not, so this never collides genuinely distinct businesses.
3. Normalized name + suburb + state (`dedup_key`) — the weakest
   fallback, and *only* when the result carries real location context
   (see `_has_location_context` below — a live Gold Coast test run found
   two genuinely different plumbing businesses both titled "Plumber Gold
   Coast" by a search provider that never fills in suburb/state;
   matching on name alone with no location collided them and silently
   blocked importing one). Name-only matching with no location signal is
   a false-positive risk too high to accept.

Checked against two different tables, because a discovered candidate can
duplicate either:
- an existing CRM `Business` (already a lead/client — re-discovering it
  should not create a second review item), or
- a `DiscoveredBusiness` from an earlier search in the same workspace
  (the same listing resurfaced by a later search).
"""

import re
import uuid
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.integrations.discovery.base import NormalizedBusinessResult
from app.modules.businesses.models import Business
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch

_SUFFIX_RE = re.compile(r"\b(pty\.?\s*ltd\.?|pty|ltd|llc|inc|co)\b")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize_name(name: str) -> str:
    lowered = name.lower()
    lowered = _SUFFIX_RE.sub(" ", lowered)
    lowered = _NON_ALNUM_RE.sub(" ", lowered)
    return " ".join(lowered.split())


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    return digits or None


def normalize_website(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url if "//" in url else f"//{url}")
    host = (parsed.netloc or parsed.path).lower()
    if host.startswith("www."):
        host = host[4:]
    path = parsed.path.rstrip("/") if parsed.netloc else ""
    normalized = f"{host}{path}"
    return normalized or None


def compute_dedup_key(name: str, suburb: str | None, state: str | None) -> str:
    return f"{normalize_name(name)}|{(suburb or '').strip().lower()}|{(state or '').strip().lower()}"


def normalize_address(address: str | None) -> str | None:
    """Lowercased, alphanumeric-only, whitespace-collapsed — enough to
    match "12 Marine Pde, Southport QLD 4215" against "12 Marine Parade,
    Southport, QLD" is *not* the goal (too fuzzy); this only equates
    near-identical strings. Returns None for anything too short to be a
    real street address (a bare suburb, a country)."""
    if not address:
        return None
    cleaned = " ".join(_NON_ALNUM_RE.sub(" ", address.lower()).split())
    # A real street address has a number and at least two more tokens.
    tokens = cleaned.split()
    if len(tokens) < 3 or not any(t.isdigit() for t in tokens):
        return None
    return cleaned


def _name_address_key(name: str, address: str | None) -> str | None:
    normalized_address = normalize_address(address)
    return f"{normalize_name(name)}|{normalized_address}" if normalized_address else None


def _has_location_context(suburb: str | None, state: str | None) -> bool:
    return bool((suburb or "").strip() or (state or "").strip())


def find_existing_business_match(
    db: Session, workspace_id: uuid.UUID, result: NormalizedBusinessResult
) -> Business | None:
    normalized_website = normalize_website(result.website_url)
    normalized_phone = normalize_phone(result.phone)

    candidates = list(db.scalars(select(Business).where(Business.workspace_id == workspace_id)))
    for business in candidates:
        if normalized_website and normalize_website(business.website_url) == normalized_website:
            return business
        if normalized_phone and normalize_phone(business.phone) == normalized_phone:
            return business

    if not _has_location_context(result.suburb, result.state):
        return None
    dedup_key = compute_dedup_key(result.name, result.suburb, result.state)
    for business in candidates:
        if compute_dedup_key(business.name, business.suburb, business.state) == dedup_key:
            return business
    return None


def find_duplicate_discovered_business(
    db: Session, workspace_id: uuid.UUID, result: NormalizedBusinessResult, dedup_key: str
) -> DiscoveredBusiness | None:
    candidates = list(
        db.scalars(
            select(DiscoveredBusiness)
            .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
            .where(DiscoverySearch.workspace_id == workspace_id)
        )
    )
    normalized_website = normalize_website(result.website_url)
    normalized_phone = normalize_phone(result.phone)
    result_name_address_key = _name_address_key(result.name, result.address)

    for business in candidates:
        if normalized_website and normalize_website(business.website_url) == normalized_website:
            return business
        if normalized_phone and normalize_phone(business.phone) == normalized_phone:
            return business
        if result_name_address_key and _name_address_key(business.name, business.address) == result_name_address_key:
            return business

    if not _has_location_context(result.suburb, result.state):
        return None
    for business in candidates:
        if business.dedup_key == dedup_key:
            return business
    return None
