"""
Instagram Search Discovery (Phase 2 of Instagram Discovery —
docs/05_DECISIONS.md): the `instagram_search` DiscoveryProvider that
turns a niche + multiple suburbs into `site:instagram.com` Brave
queries, extracts real profile handles, and feeds them through the
exact same ingest/dedup/review/score/CRM-import pipeline every other
provider uses.

Covers, including the batch-expansion fix for the "only one candidate
at a time" bug (see instagram_search_provider.py's module docstring for
the root cause): query generation, profile-URL extraction/exclusion,
batch extraction of every valid profile from one Brave page, two-axis
pagination (suburb × page-within-suburb, capped at MAX_PAGES_PER_SUBURB),
fallback query-variation widening (capped, page-0 only), the 10-suburb
cap, case-insensitive handle dedup (within one page, across fallback
variations, across suburb pages, across suburbs, and against existing
DiscoveredBusiness records from either provider), the 24h search cache
(now offset-aware), query/cache-hit/raw-results-checked bookkeeping, the
never-claim-no-website default, and the manual "check for website"
action.
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
    build_query_variations,
)
from app.integrations.search import SearchResult
from app.modules.discovery import dedup, search_cache, service
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch, DiscoverySearchCache


def _simple_provider(**overrides) -> InstagramSearchDiscoveryProvider:
    """A provider instance with fallback widening disabled by default
    (fallback_min_valid_results=1, so the strict query alone always
    satisfies it) — for tests about extraction/pagination/dedup that
    aren't themselves testing the fallback-widening behavior. Pass
    overrides (e.g. max_pages_per_suburb=2) to tune other knobs."""
    provider = InstagramSearchDiscoveryProvider()
    provider.fallback_min_valid_results = 1
    for key, value in overrides.items():
        setattr(provider, key, value)
    return provider


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


def test_build_query_variations_are_strict_to_broad_and_capped():
    variations = build_query_variations("nail salon", "Surfers Paradise")
    assert variations == [
        'site:instagram.com "nail salon" "Surfers Paradise"',
        'site:instagram.com nail salon "Surfers Paradise"',
        'site:instagram.com "nail salon" Surfers Paradise',
    ]
    assert variations[0] == build_query("nail salon", "Surfers Paradise")


def test_build_query_variations_respects_max_variations_override():
    assert len(build_query_variations("nail salon", "Surfers Paradise", max_variations=1)) == 1
    assert len(build_query_variations("nail salon", "Surfers Paradise", max_variations=2)) == 2


def test_build_query_variations_never_produces_duplicate_strings():
    # Defensive: even if two candidate variations happened to render
    # identically, the caller never gets the same query string twice.
    variations = build_query_variations("x", "y")
    assert len(variations) == len(set(variations))


# --- Provider-level: single-page batch extraction ----------------------------


def test_provider_extracts_every_valid_profile_from_one_page(monkeypatch):
    """The core batch-expansion fix: a single Brave page can and should
    yield many candidates in one DiscoveryPage, not one per call."""
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="Nail salon"),
            SearchResult(title="Glow Nails", url="https://instagram.com/glownails", description="Nail salon"),
            SearchResult(title="Beach Nails", url="https://instagram.com/beachnails", description="Nail salon"),
            SearchResult(title="Studio Nails", url="https://instagram.com/studionails", description="Nail salon"),
            SearchResult(title="A reel", url="https://instagram.com/reel/abc123/", description="not a profile"),
        ],
    )
    provider = _simple_provider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"]))

    assert {r.instagram_handle for r in page.results} == {"joesnails", "glownails", "beachnails", "studionails"}
    assert page.raw_results_checked == 5
    assert page.queries_used == 1  # one Brave call produced all four candidates


def test_provider_ignores_generic_instagram_profile_name_and_parses_title(monkeypatch):
    """Regression test — found via live QA against the real Brave API:
    Brave's `profile.name` for every instagram.com result is literally
    the site name "Instagram", not the business's own name (unlike a
    plain web search, where profile_name genuinely is a brand name).
    Trusting it gave every candidate the same name "Instagram", which
    then collided distinct businesses at the same suburb onto one
    dedup_key and silently dropped all but one of them at ingestion —
    see dedup.compute_dedup_key. Real title also included a trailing
    "(@handle) • Instagram photos and videos" suffix that must be
    stripped, not kept as part of the name."""
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(
                title="Polish Nail Lounge Pacfair (@polishnailloungepacfair) • Instagram photos and videos",
                url="https://instagram.com/polishnailloungepacfair",
                description="49 Followers...",
                profile_name="Instagram",
            ),
            SearchResult(
                title="Star Beauty Nails Broadbeach (@nailsbeautybroadbeach) • Instagram photos and videos",
                url="https://instagram.com/nailsbeautybroadbeach",
                description="1,200 Followers...",
                profile_name="Instagram",
            ),
        ],
    )
    provider = _simple_provider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Broadbeach"]))

    names = {r.instagram_handle: r.name for r in page.results}
    assert names == {
        "polishnailloungepacfair": "Polish Nail Lounge Pacfair",
        "nailsbeautybroadbeach": "Star Beauty Nails Broadbeach",
    }
    assert "Instagram" not in names.values()
    # The actual regression: two distinct businesses must never collapse
    # onto the same dedup_key just because their name was mis-extracted.
    assert dedup.compute_dedup_key(names["polishnailloungepacfair"], "Broadbeach", None) != dedup.compute_dedup_key(
        names["nailsbeautybroadbeach"], "Broadbeach", None
    )


def test_provider_falls_back_to_handle_when_title_is_also_generic(monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Instagram", url="https://instagram.com/joesnails", description="", profile_name="Instagram"),
        ],
    )
    provider = _simple_provider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Broadbeach"]))
    assert page.results[0].name == "@joesnails"


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
    provider = _simple_provider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"], offset=0))

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
    provider = _simple_provider()
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
    provider = _simple_provider()
    locations = [f"Suburb{i}" for i in range(15)]  # over MAX_SUBURBS_PER_SEARCH

    first = provider.discover(DiscoveryCriteria(industry="Cafe", locations=locations, suburb_index=0))
    assert first.has_more is True
    assert first.next_suburb_index == 1

    last = provider.discover(DiscoveryCriteria(industry="Cafe", locations=locations, suburb_index=9))
    assert last.has_more is False  # clamped to 10 suburbs, not 15
    assert last.next_suburb_index == 10


def test_provider_marks_live_query_vs_cache_hit(db_session, monkeypatch):
    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        return [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    provider = _simple_provider()
    criteria = DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"])

    first = provider.discover(criteria, db=db_session)
    assert first.queries_used == 1
    assert first.cache_hits == 0
    assert calls["n"] == 1

    second = provider.discover(criteria, db=db_session)
    assert second.queries_used == 0
    assert second.cache_hits == 1
    assert calls["n"] == 1  # no second live call — served from cache


# --- Result-page pagination: page within a suburb -----------------------------


def test_provider_pages_deeper_into_same_suburb_before_advancing(monkeypatch):
    """The direct fix for the reported bug: "load more" must deepen into
    the current suburb's own Brave pagination before moving to the next
    suburb — not jump straight to a different suburb after one page."""
    calls = []

    def fake_search(query, count=None, offset=None):
        calls.append(offset)
        if offset == 0:
            # A full page (== BRAVE_MAX_COUNT) signals Brave has more.
            return [
                SearchResult(title=f"Salon {i}", url=f"https://instagram.com/salon{i}", description="")
                for i in range(20)
            ]
        return [SearchResult(title="Salon 20", url="https://instagram.com/salon20", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    provider = _simple_provider()
    locations = ["Surfers Paradise", "Broadbeach"]

    page0 = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=locations, suburb_index=0, offset=0))
    assert len(page0.results) == 20
    assert page0.has_more is True
    assert page0.next_suburb_index == 0  # same suburb
    assert page0.next_offset == 1  # deeper page, not the next suburb

    page1 = provider.discover(
        DiscoveryCriteria(industry="Nail Salon", locations=locations, suburb_index=page0.next_suburb_index, offset=page0.next_offset)
    )
    assert [r.instagram_handle for r in page1.results] == ["salon20"]
    assert page1.has_more is True  # Broadbeach still ahead
    assert page1.next_suburb_index == 1
    assert page1.next_offset == 0  # reset for the new suburb

    assert calls == [0, 1]  # Brave's own offset actually advanced


def test_provider_respects_max_pages_per_suburb_cap(monkeypatch):
    """Server-side cap: never more than max_pages_per_suburb Brave pages
    for one suburb, even if Brave keeps claiming more are available —
    "do not create an unbounded loop"."""
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title=f"Salon {i}", url=f"https://instagram.com/salon{offset}_{i}", description="")
            for i in range(20)
        ],
    )
    provider = _simple_provider(max_pages_per_suburb=2)
    locations = ["Surfers Paradise", "Broadbeach"]

    page0 = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=locations, suburb_index=0, offset=0))
    assert page0.next_offset == 1
    assert page0.next_suburb_index == 0

    page1 = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=locations, suburb_index=0, offset=1))
    # Capped at 2 pages for this suburb — must move on to the next
    # suburb now, never a third page of Surfers Paradise.
    assert page1.next_offset == 0
    assert page1.next_suburb_index == 1
    assert page1.has_more is True  # Broadbeach is still ahead


def test_provider_does_not_loop_unboundedly_with_a_single_suburb(monkeypatch):
    """The default cap (3) applied to a single-suburb search: after the
    cap is hit, has_more must go False overall — not spin forever."""
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title=f"Salon {i}", url=f"https://instagram.com/s{offset}_{i}", description="")
            for i in range(20)
        ],
    )
    provider = _simple_provider()  # default max_pages_per_suburb == 3
    locations = ["Surfers Paradise"]
    criteria_offsets = [0, 1, 2]
    last_page = None
    for o in criteria_offsets:
        last_page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=locations, suburb_index=0, offset=o))
        if o < 2:
            assert last_page.has_more is True

    assert last_page.next_offset == 0
    assert last_page.next_suburb_index == 1
    assert last_page.has_more is False  # no more suburbs, cap reached


def test_criteria_offset_beyond_cap_is_clamped(monkeypatch):
    """Defensive: even a caller passing an out-of-range offset never
    causes the provider to fetch a 4th page for one suburb."""
    seen_offsets = []
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: (seen_offsets.append(offset), [])[1],
    )
    provider = _simple_provider()
    provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"], suburb_index=0, offset=99))
    assert max(seen_offsets) == provider.max_pages_per_suburb - 1


# --- Fallback query-variation widening (page 0 only, capped) -----------------


def test_fallback_widens_when_initial_query_is_sparse(monkeypatch):
    call_queries = []

    def fake_search(query, count=None, offset=None):
        call_queries.append(query)
        if len(call_queries) == 1:
            return [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]
        if len(call_queries) == 2:
            return [
                SearchResult(title="Glow Nails", url="https://instagram.com/glownails", description=""),
                SearchResult(title="Beach Nails", url="https://instagram.com/beachnails", description=""),
            ]
        raise AssertionError("a third variation should never be tried once the threshold is met")

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    provider = InstagramSearchDiscoveryProvider()  # real default threshold (3)
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"]))

    assert {r.instagram_handle for r in page.results} == {"joesnails", "glownails", "beachnails"}
    assert page.queries_used == 2  # stopped widening once 3 valid candidates were found
    assert len(call_queries) == 2
    assert call_queries[0] == build_query("Nail Salon", "Surfers Paradise")
    assert call_queries[1] != call_queries[0]  # a genuinely broader variation


def test_fallback_never_exceeds_max_variations(monkeypatch):
    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        # Always sparse — never reaches the fallback threshold.
        return [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    provider = InstagramSearchDiscoveryProvider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"]))

    assert calls["n"] == 3  # exactly MAX_QUERY_VARIATIONS_PER_SUBURB, never more
    assert page.queries_used == 3
    assert len(page.results) == 1  # same handle every variation — deduped, not tripled


def test_fallback_stops_early_once_no_error_but_variations_exhausted_returns_cleanly(monkeypatch):
    """A suburb that's genuinely sparse across every variation is not an
    error — a real query that found little is still a valid result."""
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: [])
    provider = InstagramSearchDiscoveryProvider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"]))
    assert page.results == []
    assert page.queries_used == 3
    assert page.raw_results_checked == 0


def test_fallback_only_applies_to_page_zero(monkeypatch):
    """A deeper page (page_offset > 0) of an already-paging suburb never
    triggers fallback widening — only one live call, even if sparse."""
    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        return [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    provider = InstagramSearchDiscoveryProvider()
    page = provider.discover(
        DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"], suburb_index=0, offset=1)
    )
    assert calls["n"] == 1
    assert page.queries_used == 1


def test_fallback_brave_outage_on_one_variation_does_not_discard_earlier_candidates(monkeypatch):
    call_queries = []

    def fake_search(query, count=None, offset=None):
        call_queries.append(query)
        if len(call_queries) == 1:
            return [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]
        return None  # Brave goes down for the remaining variations

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    provider = InstagramSearchDiscoveryProvider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"]))
    assert [r.instagram_handle for r in page.results] == ["joesnails"]
    assert page.queries_used == 1


def test_fallback_raises_when_every_variation_is_unavailable(monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: None)
    provider = InstagramSearchDiscoveryProvider()
    try:
        provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"]))
        assert False, "expected ProviderUnavailableError"
    except ProviderUnavailableError:
        pass


# --- Dedup across fallback variations and pages (provider-level) -------------


def test_dedup_applies_across_fallback_variations(monkeypatch):
    call_queries = []

    def fake_search(query, count=None, offset=None):
        call_queries.append(query)
        # Every variation happens to resurface the same handle plus one
        # new one each time — the repeat must never be double-counted.
        return [
            SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description=""),
            SearchResult(title="New Nails", url=f"https://instagram.com/new{len(call_queries)}", description=""),
        ]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    provider = InstagramSearchDiscoveryProvider()
    page = provider.discover(DiscoveryCriteria(industry="Nail Salon", locations=["Surfers Paradise"]))

    handles = [r.instagram_handle for r in page.results]
    assert handles.count("joesnails") == 1
    assert len(handles) == len(set(handles))  # every handle unique


# --- Search cache (now offset-aware) ------------------------------------------


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
    row = db_session.query(DiscoverySearchCache).filter_by(query_text="stale query", brave_offset=0).one()
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


def test_cached_search_distinguishes_by_brave_offset(db_session, monkeypatch):
    """The same query text at offset 0 vs. offset 1 must never share a
    cache row — they're different Brave API calls with different
    results (this is what makes deeper-page pagination correct)."""
    calls = []

    def fake_search(query, count=None, offset=None):
        calls.append(offset)
        return [SearchResult(title=f"Page {offset}", url=f"https://instagram.com/page{offset}", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)

    page0_results, hit0 = search_cache.cached_search(db_session, "site:instagram.com \"x\" \"y\"", count=20, offset=0)
    page1_results, hit1 = search_cache.cached_search(db_session, "site:instagram.com \"x\" \"y\"", count=20, offset=1)
    assert hit0 is False and hit1 is False
    assert calls == [0, 1]
    assert page0_results[0].url != page1_results[0].url
    assert db_session.query(DiscoverySearchCache).count() == 2

    # Re-fetching page 0 hits its own cache row, unaffected by page 1's.
    page0_again, hit0_again = search_cache.cached_search(db_session, "site:instagram.com \"x\" \"y\"", count=20, offset=0)
    assert hit0_again is True
    assert page0_again[0].url == page0_results[0].url
    assert calls == [0, 1]  # no new live call


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


def _mock_instagram_search(monkeypatch, by_suburb: dict[str, list[SearchResult]], disable_fallback: bool = True):
    """Serves results depending on which suburb's phrase appears in the
    query — mirrors how one search_business call maps to one suburb's
    query in instagram_search_provider.py. Matches on the bare suburb
    text (not just its quoted form), since a fallback variation may
    drop quoting around it. `disable_fallback=True` (the default) keeps
    every suburb-page-0 fetch to exactly one live query, matching every
    test that isn't itself about fallback widening — see
    test_fallback_*() for the dedicated fallback tests."""

    def fake_search(query, count=None, offset=None):
        for suburb, results in by_suburb.items():
            if suburb in query:
                return results
        return []

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    if disable_fallback:
        monkeypatch.setattr(InstagramSearchDiscoveryProvider, "fallback_min_valid_results", 1)


def test_create_search_requires_suburbs_for_instagram_search(authed_client):
    res = authed_client.post(
        "/api/v1/discovery-searches", json={"industry": "Nail Salon", "provider": "instagram_search"}
    )
    assert res.status_code == 400


def test_create_search_requires_a_niche_for_instagram_search(authed_client):
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"provider": "instagram_search", "location": "Surfers Paradise"},
    )
    assert res.status_code == 400


def test_create_search_rejects_more_than_ten_suburbs(authed_client):
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={
            "industry": "Nail Salon",
            "provider": "instagram_search",
            "location": ", ".join(f"Suburb{i}" for i in range(11)),
        },
    )
    assert res.status_code == 400


def test_instagram_search_location_field_accepts_a_single_suburb_with_no_comma(authed_client, monkeypatch):
    """The location field works exactly like every other provider's when
    only one suburb is entered — no comma required."""
    _mock_instagram_search(
        monkeypatch,
        {"Surfers Paradise": [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]},
    )
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": "Surfers Paradise"},
    )
    assert res.status_code == 201
    assert res.json()["suburbs"] == ["Surfers Paradise"]


def test_instagram_search_location_field_trims_whitespace_around_commas(authed_client, monkeypatch):
    _mock_instagram_search(
        monkeypatch,
        {
            "Surfers Paradise": [SearchResult(title="A", url="https://instagram.com/a", description="")],
            "Broadbeach": [SearchResult(title="B", url="https://instagram.com/b", description="")],
        },
    )
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": "  Surfers Paradise ,  Broadbeach  "},
    )
    assert res.status_code == 201
    assert res.json()["suburbs"] == ["Surfers Paradise", "Broadbeach"]


def test_instagram_search_location_field_ignores_empty_entries_between_commas(authed_client, monkeypatch):
    _mock_instagram_search(
        monkeypatch,
        {"Surfers Paradise": [SearchResult(title="A", url="https://instagram.com/a", description="")]},
    )
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": "Surfers Paradise,,"},
    )
    assert res.status_code == 201
    assert res.json()["suburbs"] == ["Surfers Paradise"]


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
            "location": "Surfers Paradise",
            "query_label": "GC nail salons",
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "completed"
    assert body["result_count"] == 1
    assert body["queries_used"] == 1
    assert body["cache_hits"] == 0
    assert body["raw_results_checked"] == 1
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


def test_create_search_batch_imports_every_valid_profile_from_one_response(authed_client, monkeypatch):
    """The direct regression test for "returning too few candidates —
    sometimes only one at a time": one Brave response with several
    valid profiles must create several candidates in a single request,
    not one per click."""
    _mock_instagram_search(
        monkeypatch,
        {
            "Surfers Paradise": [
                SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="Nail salon"),
                SearchResult(title="Glow Nails", url="https://instagram.com/glownails", description="Nail salon"),
                SearchResult(title="Beach Nails", url="https://instagram.com/beachnails", description="Nail salon"),
                SearchResult(title="A reel", url="https://instagram.com/reel/xyz/", description="not a profile"),
                SearchResult(title="Directory", url="https://yellowpages.com.au/nails", description="not instagram"),
            ]
        },
    )
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": "Surfers Paradise"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["result_count"] == 3
    assert body["queries_used"] == 1  # one live Brave call, batch-extracted
    assert body["raw_results_checked"] == 5

    handles = {
        r["instagram_handle"] for r in authed_client.get(f"/api/v1/discovery-searches/{body['id']}/results").json()
    }
    assert handles == {"joesnails", "glownails", "beachnails"}


def test_create_search_does_not_collapse_distinct_businesses_with_generic_profile_name(authed_client, monkeypatch):
    """End-to-end version of the "Instagram" generic-name regression:
    before the fix, every candidate's name became the literal string
    "Instagram" (Brave's profile_name for any instagram.com result),
    and the existing name+suburb dedup_key then collapsed every one of
    them onto a single surviving row. Both real, distinct businesses
    below must survive as separate DiscoveredBusiness rows."""

    def fake_search(query, count=None, offset=None):
        return [
            SearchResult(
                title="Polish Nail Lounge Pacfair (@polishnailloungepacfair) • Instagram photos and videos",
                url="https://instagram.com/polishnailloungepacfair",
                description="",
                profile_name="Instagram",
            ),
            SearchResult(
                title="Star Beauty Nails Broadbeach (@nailsbeautybroadbeach) • Instagram photos and videos",
                url="https://instagram.com/nailsbeautybroadbeach",
                description="",
                profile_name="Instagram",
            ),
        ]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    monkeypatch.setattr(InstagramSearchDiscoveryProvider, "fallback_min_valid_results", 1)

    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": "Broadbeach"},
    )
    body = res.json()
    assert body["result_count"] == 2  # both survive — not collapsed to 1

    rows = authed_client.get(f"/api/v1/discovery-searches/{body['id']}/results").json()
    names = {r["name"] for r in rows}
    assert names == {"Polish Nail Lounge Pacfair", "Star Beauty Nails Broadbeach"}


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
            "location": "Southport, Broadbeach",
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


def test_load_more_pages_deeper_into_one_suburb_before_moving_to_the_next(authed_client, monkeypatch):
    """End-to-end version of the pagination fix: a suburb whose page 0
    is a full (has-more) Brave page must be paged deeper by "load more"
    before a second suburb is ever touched."""

    def fake_search(query, count=None, offset=None):
        if "Surfers Paradise" in query:
            if offset == 0:
                return [
                    SearchResult(title=f"Salon {i}", url=f"https://instagram.com/salon{i}", description="")
                    for i in range(20)
                ]
            return [SearchResult(title="Salon 20", url="https://instagram.com/salon20", description="")]
        if "Broadbeach" in query:
            return [SearchResult(title="Beach Nails", url="https://instagram.com/beachnails", description="")]
        return []

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    monkeypatch.setattr(InstagramSearchDiscoveryProvider, "fallback_min_valid_results", 1)

    created = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": "Surfers Paradise, Broadbeach"},
    ).json()
    assert created["result_count"] == 20
    assert created["has_more"] is True

    more1 = authed_client.post(f"/api/v1/discovery-searches/{created['id']}/load-more").json()
    # Page 2 of Surfers Paradise, NOT Broadbeach yet.
    assert more1["result_count"] == 21
    assert more1["has_more"] is True
    handles_after_page2 = {
        r["instagram_handle"]
        for r in authed_client.get(f"/api/v1/discovery-searches/{created['id']}/results").json()
    }
    assert "beachnails" not in handles_after_page2
    assert "salon20" in handles_after_page2

    more2 = authed_client.post(f"/api/v1/discovery-searches/{created['id']}/load-more").json()
    # Surfers Paradise exhausted (max_pages_per_suburb default is 3, but
    # Brave itself signalled no more after the short page-1 response) —
    # now Broadbeach.
    assert more2["result_count"] == 22
    handles_final = {
        r["instagram_handle"]
        for r in authed_client.get(f"/api/v1/discovery-searches/{created['id']}/results").json()
    }
    assert "beachnails" in handles_final


def test_second_search_reuses_cache_for_same_niche_and_suburb(authed_client, monkeypatch):
    calls = {"n": 0}

    def fake_search(query, count=None, offset=None):
        calls["n"] += 1
        return [SearchResult(title="Joe's Nails", url="https://instagram.com/joesnails", description="")]

    monkeypatch.setattr(search_integration, "search_business", fake_search)
    monkeypatch.setattr(InstagramSearchDiscoveryProvider, "fallback_min_valid_results", 1)

    payload = {"industry": "Nail Salon", "provider": "instagram_search", "location": "Surfers Paradise"}
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
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": "Surfers Paradise"},
    ).json()
    assert search["result_count"] == 1
    row = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()[0]
    assert row["duplicate_of_discovered_business_id"] == csv_business_id


def test_instagram_search_provider_unavailable_marks_search_failed(authed_client, monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: None)
    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": "Surfers Paradise"},
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
        json={"industry": "Nail Salon", "provider": "instagram_search", "location": suburb},
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
