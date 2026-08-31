"""
Google Places discovery provider (T11) — a real business/places source.
Every external call is mocked; the suite never touches the live API.
"""

import httpx
import pytest

from app.integrations import places
from app.integrations.discovery import google_places_provider as gpp
from app.integrations.discovery.base import DiscoveryCriteria, ProviderUnavailableError, WebsiteStatus


# --- places.py: response parsing -------------------------------------------


def _place(**over):
    base = {
        "id": "ChIJ_koffee",
        "displayName": {"text": "Koffee Shack"},
        "formattedAddress": "31 Connor St, Burleigh Heads QLD 4220, Australia",
        "addressComponents": [
            {"types": ["locality"], "longText": "Burleigh Heads", "shortText": "Burleigh Heads"},
            {"types": ["administrative_area_level_1"], "longText": "Queensland", "shortText": "QLD"},
            {"types": ["postal_code"], "longText": "4220"},
            {"types": ["country"], "longText": "Australia", "shortText": "AU"},
        ],
        "location": {"latitude": -28.0899, "longitude": 153.4515},
        "nationalPhoneNumber": "(07) 5535 1234",
        "websiteUri": "https://koffeeshack.com/",
        "primaryTypeDisplayName": {"text": "Cafe"},
        "types": ["cafe", "food", "point_of_interest"],
    }
    base.update(over)
    return base


def _mock_search(monkeypatch, payload, *, calls=None):
    def fake_post(url, json, headers, timeout):
        if calls is not None:
            calls.append(json)
        resp = httpx.Response(200, json=payload, request=httpx.Request("POST", url))
        return resp

    monkeypatch.setattr("app.core.settings.settings.google_places_api_key", "test-key")
    monkeypatch.setattr(places.httpx, "post", fake_post)


def test_text_search_maps_all_fields(monkeypatch):
    _mock_search(monkeypatch, {"places": [_place()]})
    page = places.text_search("cafe burleigh heads")
    assert page is not None
    r = page.results[0]
    assert r.place_id == "ChIJ_koffee"
    assert r.name == "Koffee Shack"
    assert r.suburb == "Burleigh Heads"
    assert r.state == "QLD"
    assert r.postcode == "4220"
    assert r.country == "Australia"
    assert r.phone == "(07) 5535 1234"
    assert r.website_url == "https://koffeeshack.com/"
    assert r.website_absent is False
    assert r.category == "Cafe"
    assert (round(r.latitude, 2), round(r.longitude, 2)) == (-28.09, 153.45)


def test_text_search_business_without_website(monkeypatch):
    p = _place(id="ChIJ_nowebsite", displayName={"text": "Nimbin Barber"})
    p.pop("websiteUri")
    _mock_search(monkeypatch, {"places": [p]})
    r = places.text_search("barber nimbin").results[0]
    assert r.website_url is None
    assert r.website_absent is True


def test_text_search_returns_none_without_key(monkeypatch):
    monkeypatch.setattr("app.core.settings.settings.google_places_api_key", None)
    assert places.text_search("anything") is None


def test_text_search_returns_none_on_http_error(monkeypatch):
    def boom(*a, **k):
        raise httpx.ConnectError("nope")

    monkeypatch.setattr("app.core.settings.settings.google_places_api_key", "test-key")
    monkeypatch.setattr(places.httpx, "post", boom)
    assert places.text_search("anything") is None


def test_parse_components_handles_missing_and_extra():
    got = places._parse_components(
        [
            {"types": ["route"], "longText": "Connor St"},
            {"types": ["locality"], "longText": "Southport"},
        ]
    )
    assert got == {"suburb": "Southport"}


# --- google_places_provider.py -------------------------------------------


def test_provider_normalizes_website_and_no_website(monkeypatch):
    with_site = _place()
    without = _place(id="ChIJ_x", displayName={"text": "No Site Bakery"})
    without.pop("websiteUri")
    _mock_search(monkeypatch, {"places": [with_site, without]})

    results = gpp.GooglePlacesDiscoveryProvider().discover(
        DiscoveryCriteria(industry="Cafes", location="Burleigh Heads")
    ).results

    assert [r.name for r in results] == ["Koffee Shack", "No Site Bakery"]
    assert results[0].website_status == WebsiteStatus.FOUND
    assert results[0].website_url == "https://koffeeshack.com/"
    assert results[1].website_status == WebsiteStatus.NONE
    assert results[1].website_url is None
    # structured fields carried through
    assert results[0].suburb == "Burleigh Heads"
    assert results[0].postcode == "4220"
    assert results[0].business_category == "Cafe"
    assert results[0].source_external_id == "ChIJ_koffee"
    assert (round(results[0].latitude, 2), round(results[0].longitude, 2)) == (-28.09, 153.45)


def test_provider_multiple_categories(monkeypatch):
    a = _place(id="a", displayName={"text": "A"}, primaryTypeDisplayName={"text": "Bakery"})
    b = _place(id="b", displayName={"text": "B"}, primaryTypeDisplayName={"text": "Coffee shop"})
    _mock_search(monkeypatch, {"places": [a, b]})
    results = gpp.GooglePlacesDiscoveryProvider().discover(DiscoveryCriteria(keywords="food")).results
    assert {r.business_category for r in results} == {"Bakery", "Coffee shop"}


def test_provider_pagination(monkeypatch):
    calls = []
    _mock_search(monkeypatch, {"places": [_place()], "nextPageToken": "TOK1"}, calls=calls)
    page0 = gpp.GooglePlacesDiscoveryProvider().discover(DiscoveryCriteria(keywords="cafe", offset=0))
    assert page0.has_more is True
    assert "pageToken" not in calls[-1]


def test_provider_pagination_walks_token_to_offset(monkeypatch):
    calls = []

    def fake_post(url, json, headers, timeout):
        calls.append(json)
        n = len(calls)
        payload = {"places": [_place(id=f"p{n}", displayName={"text": f"Cafe {n}"})]}
        if n < 3:
            payload["nextPageToken"] = f"TOK{n}"
        return httpx.Response(200, json=payload, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.core.settings.settings.google_places_api_key", "test-key")
    monkeypatch.setattr(places.httpx, "post", fake_post)

    page1 = gpp.GooglePlacesDiscoveryProvider().discover(DiscoveryCriteria(keywords="cafe", offset=1))
    assert [c.get("pageToken") for c in calls] == [None, "TOK1"]
    assert page1.results[0].name == "Cafe 2"
    assert page1.has_more is True  # TOK2 present, offset 1 < max 2


def test_provider_unavailable_without_key(monkeypatch):
    monkeypatch.setattr("app.core.settings.settings.google_places_api_key", None)
    with pytest.raises(ProviderUnavailableError):
        gpp.GooglePlacesDiscoveryProvider().discover(DiscoveryCriteria(keywords="cafe"))


def test_provider_unavailable_on_api_failure(monkeypatch):
    monkeypatch.setattr("app.core.settings.settings.google_places_api_key", "test-key")
    monkeypatch.setattr(places.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(httpx.ConnectError("x")))
    with pytest.raises(ProviderUnavailableError):
        gpp.GooglePlacesDiscoveryProvider().discover(DiscoveryCriteria(keywords="cafe"))


def test_provider_empty_query_returns_empty(monkeypatch):
    _mock_search(monkeypatch, {"places": []})
    page = gpp.GooglePlacesDiscoveryProvider().discover(DiscoveryCriteria())
    assert page.results == [] and page.has_more is False


# --- registry -------------------------------------------------------------


def test_default_provider_prefers_google_places_when_configured(monkeypatch):
    from app.integrations.discovery import registry

    monkeypatch.setattr("app.core.settings.settings.google_places_api_key", "k")
    assert registry.default_provider() == "google_places"
    monkeypatch.setattr("app.core.settings.settings.google_places_api_key", None)
    assert registry.default_provider() == "brave_search"


def test_registry_still_serves_both_providers():
    from app.integrations.discovery import registry

    assert set(registry.available_providers()) == {"brave_search", "google_places"}
