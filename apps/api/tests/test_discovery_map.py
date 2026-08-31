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


def test_extracts_address_and_geo_from_localbusiness():
    addr, lat, lng = _extract_location_from_jsonld(
        _blocks(
            {
                "@context": "https://schema.org",
                "@type": "LocalBusiness",
                "name": "Bean There Cafe",
                "address": {
                    "@type": "PostalAddress",
                    "streetAddress": "12 Marine Pde",
                    "addressLocality": "Southport",
                    "addressRegion": "QLD",
                    "postalCode": "4215",
                },
                "geo": {"@type": "GeoCoordinates", "latitude": -27.967, "longitude": 153.412},
            }
        )
    )
    assert addr == "12 Marine Pde, Southport, QLD, 4215"
    assert (round(lat, 3), round(lng, 3)) == (-27.967, 153.412)


def test_extracts_from_graph_wrapper_and_string_coords():
    _, lat, lng = _extract_location_from_jsonld(
        _blocks(
            {
                "@graph": [
                    {"@type": "WebSite", "name": "x"},
                    {"@type": "Organization", "geo": {"latitude": "-33.87", "longitude": "151.21"}},
                ]
            }
        )
    )
    assert (round(lat, 2), round(lng, 2)) == (-33.87, 151.21)


def test_address_only_when_no_geo():
    addr, lat, lng = _extract_location_from_jsonld(
        _blocks({"@type": "LocalBusiness", "address": "5 Short St, Nimbin NSW"})
    )
    assert addr == "5 Short St, Nimbin NSW"
    assert lat is None and lng is None


def test_ignores_malformed_json_and_out_of_range_coords():
    addr, lat, lng = _extract_location_from_jsonld(
        ["{ not json", json.dumps({"@type": "LocalBusiness", "geo": {"latitude": 999, "longitude": 10}})]
    )
    assert addr is None and lat is None and lng is None


def test_zero_zero_is_not_a_location():
    _, lat, lng = _extract_location_from_jsonld(
        _blocks({"@type": "LocalBusiness", "geo": {"latitude": 0, "longitude": 0}})
    )
    assert lat is None and lng is None


def test_no_blocks():
    assert _extract_location_from_jsonld([]) == (None, None, None)


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
