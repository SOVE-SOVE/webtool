"""
Lead Discovery map (T4): coordinates come only from a source that
actually has them — a provider, or GeoCoordinates a site publishes in
its own schema.org (JSON-LD) markup. Never geocoded from a name/city.
"""

import json

from app.integrations.browser import _extract_location_from_jsonld
from app.integrations.discovery.base import NormalizedBusinessResult, WebsiteStatus


def _blocks(*objs):
    return [json.dumps(o) for o in objs]


def test_extracts_address_geo_country_category_from_localbusiness():
    loc = _extract_location_from_jsonld(
        _blocks(
            {
                "@context": "https://schema.org",
                "@type": "CafeOrCoffeeShop",
                "name": "Bean There Cafe",
                "address": {
                    "@type": "PostalAddress",
                    "streetAddress": "12 Marine Pde",
                    "addressLocality": "Southport",
                    "addressRegion": "QLD",
                    "postalCode": "4215",
                    "addressCountry": "AU",
                },
                "geo": {"@type": "GeoCoordinates", "latitude": -27.967, "longitude": 153.412},
            }
        )
    )
    assert loc.address == "12 Marine Pde, Southport, QLD, 4215, AU"
    assert loc.country == "AU"
    assert loc.category == "Cafe or coffee shop"
    assert (round(loc.latitude, 3), round(loc.longitude, 3)) == (-27.967, 153.412)


def test_extracts_from_graph_wrapper_and_string_coords():
    loc = _extract_location_from_jsonld(
        _blocks(
            {
                "@graph": [
                    {"@type": "WebSite", "name": "x"},
                    {"@type": "Organization", "geo": {"latitude": "-33.87", "longitude": "151.21"}},
                ]
            }
        )
    )
    assert (round(loc.latitude, 2), round(loc.longitude, 2)) == (-33.87, 151.21)
    # "Organization" and "WebSite" are wrappers, not a business category.
    assert loc.category is None


def test_address_only_when_no_geo():
    loc = _extract_location_from_jsonld(_blocks({"@type": "LocalBusiness", "address": "5 Short St, Nimbin NSW"}))
    assert loc.address == "5 Short St, Nimbin NSW"
    assert loc.latitude is None and loc.longitude is None
    assert loc.category == "Local business"


def test_ignores_malformed_json_and_out_of_range_coords():
    loc = _extract_location_from_jsonld(
        ["{ not json", json.dumps({"@type": "Plumber", "geo": {"latitude": 999, "longitude": 10}})]
    )
    assert loc.address is None and loc.latitude is None and loc.longitude is None
    assert loc.category == "Plumber"


def test_zero_zero_is_not_a_location():
    loc = _extract_location_from_jsonld(_blocks({"@type": "LocalBusiness", "geo": {"latitude": 0, "longitude": 0}}))
    assert loc.latitude is None and loc.longitude is None


def test_no_blocks():
    loc = _extract_location_from_jsonld([])
    assert (loc.address, loc.country, loc.category, loc.latitude, loc.longitude) == (None, None, None, None, None)


def test_provider_coordinates_flow_through_to_the_discovered_business(authed_client, monkeypatch):
    from tests.test_business_discovery import _use_stub_provider

    _use_stub_provider(
        monkeypatch,
        [
            NormalizedBusinessResult(
                name="Mapped Co",
                website_url="https://mapped.example",
                website_status=WebsiteStatus.FOUND,
                latitude=-28.0167,
                longitude=153.4000,
                address="1 Cavill Ave, Surfers Paradise QLD",
            ),
            NormalizedBusinessResult(name="Unmapped Co", website_status=WebsiteStatus.NONE),
        ],
    )
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Cafe"}).json()
    rows = {r["name"]: r for r in authed_client.get(
        f"/api/v1/discovery-searches/{search['id']}/results"
    ).json()}

    assert rows["Mapped Co"]["latitude"] == -28.0167
    assert rows["Mapped Co"]["longitude"] == 153.4
    assert rows["Mapped Co"]["address"] == "1 Cavill Ave, Surfers Paradise QLD"
    assert rows["Unmapped Co"]["latitude"] is None
    assert rows["Unmapped Co"]["longitude"] is None
