"""
Instagram Search Discovery (Phase 2 of Instagram Discovery —
docs/05_DECISIONS.md): the `instagram_search` DiscoveryProvider that
turns a niche + multiple suburbs into `site:instagram.com` Brave
queries, extracts real profile handles, and feeds them through the
exact same ingest/dedup/review/score/CRM-import pipeline every other
provider uses. Covers: query generation, profile-URL extraction/
exclusion, the 10-suburb cap, case-insensitive handle dedup (within one
run, across suburbs, and against existing DiscoveredBusiness records
from either provider), the 24h search cache, query/cache-hit
bookkeeping, the never-claim-no-website default, and the manual "check
for website" action.
"""

import uuid

from app.integrations import search as search_integration
from app.integrations.discovery.base import (
    DiscoveryCriteria,
    InstagramWebsiteStatus,
    LocationConfidence,
    NormalizedBusinessResult,
    ProviderUnavailableError,
    WebsiteStatus,
)
from app.integrations.discovery.instagram_search_provider import (
    InstagramSearchDiscoveryProvider,
    _extract_handle,
    build_query,
)
from app.integrations.search import SearchResult
from app.modules.discovery import dedup, search_cache, service
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch, DiscoverySearchCache


# --- Profile URL / handle extraction ----------------------------------------


def test_extract_handle_accepts_bare_and_trailing_slash_profile_urls():
    assert _extract_handle("https://instagram.com/joesplumbing") == "joesplumbing"
    assert _extract_handle("https://instagram.com/joesplumbing/") == "joesplumbing"
    assert _extract_handle("https://www.instagram.com/JoesPlumbing") == "joesplumbing"  # lowercased


def test_extract_handle_rejects_non_profile_paths():
    for url in [
        "https://instagram.com/p/Cxyz123/",
        "https://instagram.com/reel/Cabc456/",
        "https://instagram.com/reels/Cabc456/",
        "https://instagram.com/stories/somebrand/",
        "https://instagram.com/explore/tags/goldcoast/",
        "https://instagram.com/explore/",
        "https://instagram.com/accounts/login/",
        "https://instagram.com/direct/inbox/",
        "https://instagram.com/audio/12345/",
        "https://instagram.com/about/us/",
        "https://instagram.com/joesplumbing/photos",  # extra path segment
        "https://instagram.com/",  # no segment at all
    ]:
        assert _extract_handle(url) is None, url


def test_extract_handle_rejects_non_instagram_hosts():
    assert _extract_handle("https://facebook.com/joesplumbing") is None
    assert _extract_handle("https://notinstagram.com/joesplumbing") is None


def test_build_query_shape():
    assert build_query("nail salon", "Surfers Paradise") == 'site:instagram.com "nail salon" "Surfers Paradise"'


def test_build_query_strips_quote_characters_from_free_text():
    # An operator-entered phrase must never be able to break out of the
    # quoted query segments it's placed into.
    query = build_query('nail "salon"', 'Surfers "Paradise"')
    assert query == 'site:instagram.com "nail salon" "Surfers Paradise"'


# --- Provider-level normalization -------------------------------------------


def test_provider_normalizes_profile_results_and_excludes_noise(monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Joe's Nails (@joesnails)", url="https://instagram.com/joesnails", description="Nail salon in Surfers Paradise"),
            SearchResult(title="A reel", url="https://instagram.com/reel/abc123/", description="not a profile"),
            SearchResult(title="A post", url="https://instagram.com/p/xyz456/", description="not a profile"),
            SearchResult(title="Hashtag", url="https://instagram.com/explore/tags/nails/", description="not a profile"),
            SearchResult(title="Unrelated site", url="https://someblog.example/nails", description="an article"),
        ],
    )
    provider = InstagramSearchDiscoveryProvider()
    page = provider.discover(
        DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"], offset=0)
    )

    assert [r.instagram_handle for r in page.results] == ["joesnails"]
    result = page.results[0]
    assert result.instagram_profile_url == "https://instagram.com/joesnails"
    assert result.website_url is None
    assert result.website_status == WebsiteStatus.UNKNOWN
    assert result.instagram_website_status == InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW
    assert result.location_confidence == LocationConfidence.APPROXIMATE
    assert result.suburb == "Surfers Paradise"
    assert result.raw_snippet == "Nail salon in Surfers Paradise"
    assert result.social_links == ["https://instagram.com/joesnails"]


def test_provider_dedups_handles_case_insensitively_within_one_page(monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Joe's Nails", url="https://instagram.com/JoesNails", description=""),
            SearchResult(title="Joe's Nails again", url="https://instagram.com/joesnails/", description=""),
        ],
    )
    provider = InstagramSearchDiscoveryProvider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"]))
    assert len(page.results) == 1


def test_provider_requires_at_least_one_suburb():
    provider = InstagramSearchDiscoveryProvider()
    try:
        provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=[]))
        assert False, "expected ProviderUnavailableError"
    except ProviderUnavailableError:
        pass


def test_provider_requires_a_niche():
    provider = InstagramSearchDiscoveryProvider()
    try:
        provider.discover(DiscoveryCriteria(locations=["Surfers Paradise"]))
        assert False, "expected ProviderUnavailableError"
    except ProviderUnavailableError:
        pass


def test_provider_caps_suburbs_at_the_max_and_reports_has_more(monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: [])
    provider = InstagramSearchDiscoveryProvider()
    locations = [f"Suburb{i}" for i in range(15)]  # over MAX_SUBURBS_PER_SEARCH

    first = provider.discover(DiscoveryCriteria(industry="Cafe", locations=locations, offset=0))
    assert first.has_more is True

    last = provider.discover(DiscoveryCriteria(industry="Cafe", locations=locations, offset=9))
    assert last.has_more is False  # clamped to 10 suburbs, not 15


def test_provider_marks_live_query_vs_cache_hit(db_session, monkeypatch):
    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        return [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    provider = InstagramSearchDiscoveryProvider()
    criteria = DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"])

    first = provider.discover(criteria, db=db_session)
    assert first.queries_used == 1
    assert first.cache_hits == 0
    assert calls["n"] == 1

    second = provider.discover(criteria, db=db_session)
    assert second.queries_used == 0
    assert second.cache_hits == 1
    assert calls["n"] == 1  # no second live call — served from cache


# --- Search cache ------------------------------------------------------------


def test_cached_search_reuses_result_within_ttl(db_session, monkeypatch):
    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        return [SearchResult(title="X", url="https://instagram.com/x", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)

    results1, hit1 = search_cache.cached_search(db_session, "site:instagram.com \"x\" \"y\"", count=20)
    results2, hit2 = search_cache.cached_search(db_session, "site:instagram.com \"x\" \"y\"", count=20)

    assert hit1 is False
    assert hit2 is True
    assert calls["n"] == 1
    assert [r.url for r in results1] == [r.url for r in results2]
    assert db_session.query(DiscoverySearchCache).count() == 1


def test_cached_search_expires_after_ttl(db_session, monkeypatch):
    from datetime import datetime, timedelta, timezone

    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [SearchResult(title="X", url="https://instagram.com/x", description="")],
    )
    search_cache.cached_search(db_session, "stale query", count=20)
    row = db_session.query(DiscoverySearchCache).filter_by(query_text="stale query").one()
    row.fetched_at = datetime.now(timezone.utc) - timedelta(hours=25)
    db_session.commit()

    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        return [SearchResult(title="X2", url="https://instagram.com/x2", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    results, hit = search_cache.cached_search(db_session, "stale query", count=20)
    assert hit is False
    assert calls["n"] == 1
    assert results[0].url == "https://instagram.com/x2"


def test_cached_search_without_db_never_caches(monkeypatch):
    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        return [SearchResult(title="X", url="https://instagram.com/x", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    search_cache.cached_search(None, "no db query", count=20)
    search_cache.cached_search(None, "no db query", count=20)
    assert calls["n"] == 2


# --- Handle dedup (dedup.py) --------------------------------------------------


def test_normalize_instagram_handle_strips_at_and_lowercases():
    assert dedup.normalize_instagram_handle("@JoesNails") == "joesnails"
    assert dedup.normalize_instagram_handle("joesnails") == "joesnails"
    assert dedup.normalize_instagram_handle(None) is None
    assert dedup.normalize_instagram_handle("  ") is None


def test_find_duplicate_discovered_business_matches_handle_case_insensitively(db_session, workspace):
    search = DiscoverySearch(workspace_id=workspace.id, industry="Nail Salon", provider="instagram_import")
    db_session.add(search)
    db_session.commit()
    existing = DiscoveredBusiness(
        discovery_search_id=search.id,
        name="Joe's Nails",
        source_provider="instagram_import",
        source_external_id="instagram:JoesNails",
        instagram_handle="JoesNails",
        dedup_key="joes nails||",
    )
    db_session.add(existing)
    db_session.commit()

    # A later instagram_search hit for the same handle, different case,
    # different source_external_id scheme (full URL vs "instagram:<handle>").
    result = NormalizedBusinessResult(
        name="Joe's Nails",
        instagram_handle="joesnails",
        source_external_id="https://instagram.com/joesnails",
    )
    match = dedup.find_duplicate_discovered_business(db_session, workspace.id, result, dedup_key="x|y|z")
    assert match is not None
    assert match.id == existing.id


# --- End-to-end via the service/route layer ----------------------------------


def _mock_instagram_search(monkeypatch, by_suburb: dict[str, list[SearchResult]]):
    """Serves different results depending on which suburb's quoted phrase
    appears in the query — mirrors how one search_business call maps to
    exactly one suburb's query in instagram_search_provider.py."""

    def fake_search(query, count=None, offset=None):
        for suburb, results in by_suburb.items():
            if f'"{suburb}"' in query:
                return results
        return []

    monkeypatch.setattr(search_integration, "search_business", fake_search)


def test_create_search_requires_suburbs_for_instagram_search(authed_client):
    res = authed_client.post(
        "/api/v1/discovery-searches", json={"industry": "Nail Salon", "provider": "instagram_search"}
    )
    assert res.status_code == 400


def test_create_search_requires_a_niche_for_instagram_search(authed_client):
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"provider": "instagram_search", "suburbs": ["Surfers Paradise"]},
    )
    assert res.status_code == 400


def test_create_search_rejects_more_than_ten_suburbs(authed_client):
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={
            "industry": "Nail Salon",
            "provider": "instagram_search",
            "suburbs": [f"Suburb{i}" for i in range(11)],
        },
    )
    assert res.status_code == 400


def test_create_search_instagram_search_end_to_end(authed_client, monkeypatch):
    _mock_instagram_search(
        monkeypatch,
        {
            "Surfers Paradise": [
                SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="Nail salon"),
            ]
        },
    )
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={
            "industry": "Nail Salon",
            "provider": "instagram_search",
            "suburbs": ["Surfers Paradise"],
            "query_label": "GC nail salons",
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "completed"
    assert body["result_count"] == 1
    assert body["queries_used"] == 1
    assert body["cache_hits"] == 0
    assert body["suburbs"] == ["Surfers Paradise"]
    assert body["has_more"] is False  # only one suburb requested

    results = authed_client.get(f"/api/v1/discovery-searches/{body['id']}/results").json()
    assert len(results) == 1
    row = results[0]
    assert row["source_provider"] == "instagram_search"
    assert row["instagram_handle"] == "joesnails"
    assert row["instagram_profile_url"] == "https://instagram.com/joesnails"
    assert row["instagram_website_status"] == "unknown_needs_review"
    assert row["website_status"] == "unknown"
    assert row["website_url"] is None
    assert row["location_confidence"] == "approximate"
    assert row["latitude"] is None and row["longitude"] is None  # never geocoded
    assert row["raw_snippet"] == "Nail salon"  # search-result evidence retained
    assert row["source_external_id"] == "https://instagram.com/joesnails"  # source URL retained


def test_load_more_advances_through_suburbs_and_dedups_across_them(authed_client, monkeypatch):
    _mock_instagram_search(
        monkeypatch,
        {
            "Southport": [
                SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description=""),
            ],
            "Broadbeach": [
                # Same handle again (different case) plus one new one —
                # the repeat must not create a second row.
                SearchResult(title="Joe's Nails", url="https://instagram.com/JoesNails/", description=""),
                SearchResult(title="Beach Nails", url="https://instagram.com/beachnails", description=""),
            ],
        },
    )
    created = authed_client.post(
        "/api/v1/discovery-searches",
        json={
            "industry": "Nail Salon",
            "provider": "instagram_search",
            "suburbs": ["Southport", "Broadbeach"],
        },
    ).json()
    assert created["result_count"] == 1
    assert created["has_more"] is True
    assert created["queries_used"] == 1

    more = authed_client.post(f"/api/v1/discovery-searches/{created['id']}/load-more")
    assert more.status_code == 200
    body = more.json()
    assert body["result_count"] == 2  # joesnails deduped, beachnails added
    assert body["has_more"] is False
    assert body["queries_used"] == 2

    handles = {
        r["instagram_handle"] for r in authed_client.get(f"/api/v1/discovery-searches/{created['id']}/results").json()
    }
    assert handles == {"joesnails", "beachnails"}

    # No further suburbs left.
    assert authed_client.post(f"/api/v1/discovery-searches/{created['id']}/load-more").status_code == 409


def test_second_search_reuses_cache_for_same_niche_and_suburb(authed_client, monkeypatch):
    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        return [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)

    payload = {"industry": "Nail Salon", "provider": "instagram_search", "suburbs": ["Surfers Paradise"]}
    first = authed_client.post("/api/v1/discovery-searches", json=payload).json()
    assert first["queries_used"] == 1
    assert first["cache_hits"] == 0
    assert calls["n"] == 1

    second = authed_client.post("/api/v1/discovery-searches", json=payload).json()
    assert second["queries_used"] == 0
    assert second["cache_hits"] == 1
    assert calls["n"] == 1  # served from cache, no second live Brave call


def test_instagram_search_candidate_cross_search_dedup_by_handle(authed_client, monkeypatch):
    """A handle already discovered via CSV import (Phase 1) is flagged as
    a duplicate of that row when instagram_search later finds the same
    handle under a different capitalization — same "still create the
    row, but link it back" behavior every other provider's cross-search
    dedup already has (see test_business_discovery.py's address-based
    equivalent)."""
    csv_text = "name,instagram_handle\nJoe's Nails,JoesNails\n"
    import_res = authed_client.post(
        "/api/v1/discovery-searches/instagram-import", json={"csv_text": csv_text}
    )
    assert import_res.status_code == 201
    assert import_res.json()["created_count"] == 1
    csv_business_id = authed_client.get(
        f"/api/v1/discovery-searches/{import_res.json()['search']['id']}/results"
    ).json()[0]["id"]

    _mock_instagram_search(
        monkeypatch,
        {"Surfers Paradise": [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]},
    )
    search = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "suburbs": ["Surfers Paradise"]},
    ).json()
    assert search["result_count"] == 1
    row = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()[0]
    assert row["duplicate_of_discovered_business_id"] == csv_business_id


def test_instagram_search_provider_unavailable_marks_search_failed(authed_client, monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: None)
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "suburbs": ["Surfers Paradise"]},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "failed"
    assert body["result_count"] == 0


# --- Manual "check for website" action ---------------------------------------


def _create_instagram_search_business(authed_client, monkeypatch, handle="joesnails", suburb="Surfers Paradise"):
    _mock_instagram_search(
        monkeypatch,
        {suburb: [SearchResult(title="Joe's Nails", url=f"https://instagram.com/{handle}", description="")]},
    )
    search = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "suburbs": [suburb]},
    ).json()
    return authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()[0]


def test_check_website_finds_a_real_business_website_and_confirms_via_research(authed_client, monkeypatch):
    business = _create_instagram_search_business(authed_client, monkeypatch)
    assert business["instagram_website_status"] == "unknown_needs_review"

    def fake_secondary_search(query, count=None, offset=None):
        return [
            SearchResult(title="Joe's Nails — Official Site", url="https://joesnails.example", description="Book now"),
        ]

    monkeypatch.setattr(search_integration, "search_business", fake_secondary_search)

    recorded = {}

    def fake_run_research(db, workspace_id, actor_id, business_id):
        recorded["called_with"] = business_id
        return None

    monkeypatch.setattr(service.business_research_service, "run_research", fake_run_research)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/check-instagram-website")
    assert res.status_code == 200
    body = res.json()
    assert body["instagram_website_status"] == "proper_website"
    assert body["website_status"] == "found"
    assert body["website_url"] == "https://joesnails.example"
    assert body["instagram_website_checked_at"] is not None
    assert str(recorded["called_with"]) == business["id"]


def test_check_website_finds_link_in_bio_page(authed_client, monkeypatch):
    business = _create_instagram_search_business(authed_client, monkeypatch)

    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Joe's Nails", url="https://linktr.ee/joesnails", description="Links"),
        ],
    )
    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/check-instagram-website")
    assert res.status_code == 200
    body = res.json()
    assert body["instagram_website_status"] == "link_in_bio_only"
    assert body["website_status"] == "none"
    assert body["instagram_bio_link_url"] == "https://linktr.ee/joesnails"


def test_check_website_miss_never_downgrades_to_no_website(authed_client, monkeypatch):
    business = _create_instagram_search_business(authed_client, monkeypatch)

    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: [])
    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/check-instagram-website")
    assert res.status_code == 200
    body = res.json()
    # Still needs review — a miss is not evidence of "no website".
    assert body["instagram_website_status"] == "unknown_needs_review"
    assert body["website_status"] == "unknown"
    assert body["website_url"] is None
    assert body["instagram_website_checked_at"] is not None  # but the attempt is recorded


def test_check_website_miss_when_brave_unavailable_still_records_attempt(authed_client, monkeypatch):
    business = _create_instagram_search_business(authed_client, monkeypatch)
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: None)
    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/check-instagram-website")
    assert res.status_code == 200
    body = res.json()
    assert body["instagram_website_status"] == "unknown_needs_review"
    assert body["instagram_website_checked_at"] is not None


def test_check_website_on_business_without_instagram_handle_is_rejected(authed_client, monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Plain Co", url="https://plainco.example", description=""),
        ],
    )
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()
    business = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()[0]

    res = authed_client.post(f"/api/v1/discovered-businesses/{business['id']}/check-instagram-website")
    assert res.status_code == 400


def test_check_website_on_missing_business_returns_404(authed_client):
    res = authed_client.post(f"/api/v1/discovered-businesses/{uuid.uuid4()}/check-instagram-website")
    assert res.status_code == 404
