"""
Task 2 of Phase 2 ("Lead Intelligence"): the first real capability —
running a discovery search through a provider adapter (Brave Search),
normalizing results, deduplicating against existing businesses/prior
discoveries, and persisting a reviewable results list. Covers: provider
normalization, duplicate detection, invalid searches, empty results, and
successful discovery, per the task spec.
"""

import uuid

import pytest

from app.integrations import search as search_integration
from app.integrations.discovery.base import (
    DiscoveryCriteria,
    DiscoveryPage,
    NormalizedBusinessResult,
    ProviderUnavailableError,
    WebsiteStatus,
)
from app.integrations.discovery.brave_search_provider import BraveSearchDiscoveryProvider, _extract_name
from app.integrations.search import SearchResult
from app.modules.businesses.models import Business
from app.modules.discovery import dedup


# --- Provider normalization -------------------------------------------------


def test_extract_name_splits_on_pipe_and_dash():
    assert _extract_name("Gold Coast Plumbing Co | Home") == "Gold Coast Plumbing Co"
    assert _extract_name("Gold Coast Plumbing Co - Trusted Local Plumbers") == "Gold Coast Plumbing Co"
    assert _extract_name("Just A Plain Title") == "Just A Plain Title"


def test_extract_name_splits_on_colon():
    """Found via a live Gold Coast test run: "Gold Coast Plumbing Company:
    Your Trusted Gold Coast Plumber" wasn't being split on the colon."""
    assert _extract_name("Gold Coast Plumbing Company: Your Trusted Gold Coast Plumber") == "Gold Coast Plumbing Company"


def test_extract_name_truncates_to_column_length():
    long_title = "A" * 400
    assert len(_extract_name(long_title)) == 255


def test_brave_provider_normalizes_results(monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Gold Coast Plumbing Co | Home", url="https://gcplumbing.example", description="Local plumbers"),
            SearchResult(title="Southport Plumbers - Fast Service", url="https://southportplumbers.example", description="24/7"),
        ],
    )

    provider = BraveSearchDiscoveryProvider()
    results = provider.discover(DiscoveryCriteria(industry="Plumbing", location="Gold Coast")).results

    assert len(results) == 2
    assert results[0].name == "Gold Coast Plumbing Co"
    assert results[0].website_url == "https://gcplumbing.example"
    assert results[0].industry == "Plumbing"
    assert results[0].source_external_id == "https://gcplumbing.example"
    assert results[0].raw_snippet == "Local plumbers"


def test_brave_provider_skips_results_missing_title_or_url(monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="", url="https://example.com", description=""),
            SearchResult(title="No URL Co", url="", description=""),
            SearchResult(title="Valid Co", url="https://valid.example", description=""),
        ],
    )

    provider = BraveSearchDiscoveryProvider()
    results = provider.discover(DiscoveryCriteria(industry="Plumbing")).results

    assert [r.name for r in results] == ["Valid Co"]


def test_brave_provider_filters_out_non_business_results(monkeypatch):
    """Reddit threads, listicles, news pieces and directory pages a plain
    web search returns are dropped; real business pages are kept (T1)."""
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Gold Coast Plumbing Co | Home", url="https://gcplumbing.com.au/", description=""),
            SearchResult(title="Best plumber on the GC?", url="https://www.reddit.com/r/goldcoast/comments/x", description=""),
            SearchResult(title="The 10 Best Plumbers in Queensland", url="https://someblog.example/list", description=""),
            SearchResult(title="Plumbing - Wikipedia", url="https://en.wikipedia.org/wiki/Plumbing", description=""),
            SearchResult(title="Southport Plumbers - 24/7", url="https://southportplumbers.com.au/", description=""),
        ],
    )

    provider = BraveSearchDiscoveryProvider()
    results = provider.discover(DiscoveryCriteria(industry="Plumbing", location="Gold Coast")).results

    assert [r.name for r in results] == ["Gold Coast Plumbing Co", "Southport Plumbers"]


def test_brave_provider_prefers_profile_name(monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(
                title="Home - Your Trusted Local Plumber Since 1998",
                url="https://gcplumbing.com.au/",
                description="",
                profile_name="Gold Coast Plumbing Co",
            ),
        ],
    )

    provider = BraveSearchDiscoveryProvider()
    results = provider.discover(DiscoveryCriteria(industry="Plumbing")).results

    assert results[0].name == "Gold Coast Plumbing Co"


def test_brave_provider_raises_when_search_unavailable(monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: None)

    provider = BraveSearchDiscoveryProvider()
    with pytest.raises(ProviderUnavailableError):
        provider.discover(DiscoveryCriteria(industry="Plumbing"))


def test_brave_provider_respects_limit(monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title=f"Co {i}", url=f"https://co{i}.example", description="") for i in range(10)
        ],
    )

    provider = BraveSearchDiscoveryProvider()
    results = provider.discover(DiscoveryCriteria(industry="Plumbing", limit=3)).results

    assert len(results) == 3


# --- Deduplication -----------------------------------------------------------


def test_normalize_name_strips_suffixes_and_punctuation():
    assert dedup.normalize_name("Gold Coast Plumbing Pty Ltd") == "gold coast plumbing"
    assert dedup.normalize_name("ACME, Inc.") == "acme"
    assert dedup.normalize_name("O'Brien & Sons") == "o brien sons"


def test_normalize_phone_strips_non_digits():
    assert dedup.normalize_phone("(07) 5555 1234") == "0755551234"
    assert dedup.normalize_phone(None) is None
    assert dedup.normalize_phone("") is None


def test_normalize_website_strips_scheme_and_www():
    assert dedup.normalize_website("https://www.example.com/") == "example.com"
    assert dedup.normalize_website("http://example.com") == "example.com"
    assert dedup.normalize_website(None) is None


def test_compute_dedup_key_is_stable_for_equivalent_names():
    key_a = dedup.compute_dedup_key("Gold Coast Plumbing Pty Ltd", "Southport", "QLD")
    key_b = dedup.compute_dedup_key("GOLD COAST PLUMBING", "southport", "qld")
    assert key_a == key_b


def test_find_existing_business_match_by_website(db_session, workspace):
    business = Business(workspace_id=workspace.id, name="Existing Co", website_url="https://existing.example")
    db_session.add(business)
    db_session.commit()

    result = NormalizedBusinessResult(name="Existing Co Pty Ltd", website_url="https://www.existing.example/")
    match = dedup.find_existing_business_match(db_session, workspace.id, result)

    assert match is not None
    assert match.id == business.id


def test_find_existing_business_match_by_name_and_suburb(db_session, workspace):
    business = Business(workspace_id=workspace.id, name="Existing Co", suburb="Southport", state="QLD")
    db_session.add(business)
    db_session.commit()

    result = NormalizedBusinessResult(name="EXISTING CO", suburb="Southport", state="QLD")
    match = dedup.find_existing_business_match(db_session, workspace.id, result)

    assert match is not None
    assert match.id == business.id


def test_find_existing_business_match_none_when_no_overlap(db_session, workspace):
    db_session.add(Business(workspace_id=workspace.id, name="Unrelated Co"))
    db_session.commit()

    result = NormalizedBusinessResult(name="Totally Different Co", suburb="Nowhere")
    assert dedup.find_existing_business_match(db_session, workspace.id, result) is None


def test_name_only_match_skipped_when_neither_side_has_location(db_session, workspace):
    """Found via a live Gold Coast test run: two genuinely different
    plumbing businesses (different websites) were both titled "Plumber
    Gold Coast" by Brave Search, which never supplies suburb/state.
    Matching on name alone with no location signal falsely flagged them
    as duplicates and silently blocked importing the second one."""
    business = Business(workspace_id=workspace.id, name="Plumber Gold Coast", website_url="https://one.example")
    db_session.add(business)
    db_session.commit()

    result = NormalizedBusinessResult(name="Plumber Gold Coast", website_url="https://two.example")
    assert dedup.find_existing_business_match(db_session, workspace.id, result) is None


def test_name_only_match_still_applies_when_result_has_location(db_session, workspace):
    business = Business(workspace_id=workspace.id, name="Plumber Gold Coast", suburb="Southport", state="QLD")
    db_session.add(business)
    db_session.commit()

    result = NormalizedBusinessResult(name="Plumber Gold Coast", suburb="Southport", state="QLD")
    match = dedup.find_existing_business_match(db_session, workspace.id, result)

    assert match is not None
    assert match.id == business.id


# --- Route-level: invalid searches, empty results, successful discovery -----


def test_create_search_rejects_empty_criteria(authed_client):
    res = authed_client.post("/api/v1/discovery-searches", json={})
    assert res.status_code == 400


def test_create_search_rejects_unknown_provider(authed_client):
    res = authed_client.post(
        "/api/v1/discovery-searches", json={"industry": "Plumbing", "provider": "not_a_real_provider"}
    )
    assert res.status_code == 400


def test_create_search_empty_results_completes_cleanly(authed_client, monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: [])

    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Underwater Basket Weaving"})

    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "completed"
    assert body["result_count"] == 0
    assert body["error_message"] is None


def test_create_search_provider_unavailable_marks_failed(authed_client, monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: None)

    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing", "location": "Gold Coast"})

    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "failed"
    assert body["error_message"]
    assert body["result_count"] == 0


def test_create_search_successful_discovery(authed_client, monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [
            SearchResult(title="Gold Coast Plumbing Co | Home", url="https://gcplumbing.example", description="Local plumbers"),
            SearchResult(title="Southport Plumbers", url="https://southportplumbers.example", description="24/7"),
        ],
    )

    res = authed_client.post(
        "/api/v1/discovery-searches",
        json={"industry": "Plumbing", "location": "Gold Coast", "query_label": "Plumbers on the Gold Coast"},
    )

    assert res.status_code == 201
    search = res.json()
    assert search["status"] == "completed"
    assert search["result_count"] == 2

    results = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()
    assert len(results) == 2
    names = {r["name"] for r in results}
    assert names == {"Gold Coast Plumbing Co", "Southport Plumbers"}
    assert all(r["source_provider"] == "brave_search" for r in results)
    assert all(r["status"] == "new" for r in results)
    assert all(r["duplicate_of_business_id"] is None for r in results)


class _StubProvider:
    """A provider that serves pre-canned pages — lets a test exercise
    no-website / unknown-website businesses and multi-page pagination,
    neither of which the real Brave web-search provider can produce on
    demand. `pages` is a list of result-lists, one per offset."""

    name = "stub"

    def __init__(self, pages):
        self._pages = pages

    def discover(self, criteria):
        offset = criteria.offset
        results = list(self._pages[offset]) if offset < len(self._pages) else []
        return DiscoveryPage(results=results, has_more=offset + 1 < len(self._pages))


def _use_stub_provider(monkeypatch, results):
    """Single page of `results`, nothing more to load."""
    _use_paged_stub_provider(monkeypatch, [list(results)])


def _use_paged_stub_provider(monkeypatch, pages):
    from app.integrations.discovery import registry

    monkeypatch.setattr(registry, "get_provider", lambda name: _StubProvider(pages))


def test_brave_results_are_marked_website_found(authed_client, monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [SearchResult(title="Has Site Co", url="https://hassite.example", description="")],
    )
    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"})
    results = authed_client.get(f"/api/v1/discovery-searches/{res.json()['id']}/results").json()
    assert results[0]["website_status"] == "found"


def test_business_without_website_is_kept_and_marked(authed_client, monkeypatch):
    """A missing website must not cause a business to be discarded (T2)."""
    _use_stub_provider(
        monkeypatch,
        [
            NormalizedBusinessResult(name="No Site Bakery", website_status=WebsiteStatus.NONE, suburb="Nimbin"),
            NormalizedBusinessResult(name="Maybe Site Cafe", website_status=WebsiteStatus.UNKNOWN, suburb="Byron"),
        ],
    )
    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Cafe"})
    assert res.json()["result_count"] == 2

    results = {r["name"]: r for r in authed_client.get(
        f"/api/v1/discovery-searches/{res.json()['id']}/results"
    ).json()}
    assert results["No Site Bakery"]["website_status"] == "none"
    assert results["No Site Bakery"]["website_url"] is None
    assert results["Maybe Site Cafe"]["website_status"] == "unknown"


def test_has_website_true_filter_keeps_only_confirmed_sites(authed_client, monkeypatch):
    _use_stub_provider(
        monkeypatch,
        [
            NormalizedBusinessResult(name="Has Site", website_url="https://hassite.example", website_status=WebsiteStatus.FOUND),
            NormalizedBusinessResult(name="No Site", website_status=WebsiteStatus.NONE),
        ],
    )
    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing", "has_website": True})
    results = authed_client.get(f"/api/v1/discovery-searches/{res.json()['id']}/results").json()
    assert [r["name"] for r in results] == ["Has Site"]


def test_has_website_false_filter_keeps_only_confirmed_absence(authed_client, monkeypatch):
    _use_stub_provider(
        monkeypatch,
        [
            NormalizedBusinessResult(name="Has Site", website_url="https://hassite.example", website_status=WebsiteStatus.FOUND),
            NormalizedBusinessResult(name="No Site", website_status=WebsiteStatus.NONE),
            NormalizedBusinessResult(name="Unknown Site", website_status=WebsiteStatus.UNKNOWN),
        ],
    )
    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing", "has_website": False})
    results = authed_client.get(f"/api/v1/discovery-searches/{res.json()['id']}/results").json()
    assert [r["name"] for r in results] == ["No Site"]


def test_no_website_business_can_be_imported_as_a_lead(authed_client, monkeypatch):
    _use_stub_provider(
        monkeypatch,
        [NormalizedBusinessResult(name="No Site Bakery", website_status=WebsiteStatus.NONE, suburb="Nimbin")],
    )
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Bakery"}).json()
    business_id = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()[0]["id"]

    imported = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/import")
    assert imported.status_code == 200
    assert imported.json()["status"] == "imported"
    lead_id = imported.json()["imported_lead_id"]
    lead = authed_client.get(f"/api/v1/leads/{lead_id}").json()
    assert lead["website_url"] is None


def test_second_search_flags_duplicate_of_earlier_discovered_business(authed_client, monkeypatch):
    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [SearchResult(title="Gold Coast Plumbing Co", url="https://gcplumbing.example", description="")],
    )

    first = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()
    second = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()

    first_results = authed_client.get(f"/api/v1/discovery-searches/{first['id']}/results").json()
    second_results = authed_client.get(f"/api/v1/discovery-searches/{second['id']}/results").json()

    assert second_results[0]["duplicate_of_discovered_business_id"] == first_results[0]["id"]


def test_search_flags_duplicate_of_existing_crm_business(authed_client, db_session, workspace, monkeypatch):
    db_session.add(Business(workspace_id=workspace.id, name="Gold Coast Plumbing Co", website_url="https://gcplumbing.example"))
    db_session.commit()

    monkeypatch.setattr(
        search_integration,
        "search_business",
        lambda query, count=None, offset=None: [SearchResult(title="Gold Coast Plumbing Co", url="https://gcplumbing.example", description="")],
    )

    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"})
    results = authed_client.get(f"/api/v1/discovery-searches/{res.json()['id']}/results").json()

    assert results[0]["duplicate_of_business_id"] is not None


def test_discovery_search_creation_is_rate_limited(authed_client, monkeypatch):
    monkeypatch.setattr(search_integration, "search_business", lambda query, count=None, offset=None: [])
    monkeypatch.setattr("app.core.settings.settings.llm_rate_limit_per_minute", 2)

    for _ in range(2):
        assert authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).status_code == 201

    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"})
    assert res.status_code == 429


# --- Pagination / load more (T3) --------------------------------------------


def _biz(name, url):
    return NormalizedBusinessResult(
        name=name, website_url=url, website_status=WebsiteStatus.FOUND, source_external_id=url
    )


def test_first_page_reports_more_available(authed_client, monkeypatch):
    _use_paged_stub_provider(
        monkeypatch,
        [[_biz(f"Co {i}", f"https://co{i}.example") for i in range(5)], [_biz("Later Co", "https://later.example")]],
    )
    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()
    assert res["result_count"] == 5
    assert res["has_more"] is True


def test_single_page_search_has_no_more(authed_client, monkeypatch):
    _use_stub_provider(monkeypatch, [_biz("Only Co", "https://only.example")])
    res = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()
    assert res["has_more"] is False


def test_load_more_appends_next_page(authed_client, monkeypatch):
    _use_paged_stub_provider(
        monkeypatch,
        [
            [_biz("Page1 A", "https://p1a.example"), _biz("Page1 B", "https://p1b.example")],
            [_biz("Page2 C", "https://p2c.example")],
        ],
    )
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()

    more = authed_client.post(f"/api/v1/discovery-searches/{search['id']}/load-more")
    assert more.status_code == 200
    body = more.json()
    assert body["result_count"] == 3
    assert body["has_more"] is False

    names = [r["name"] for r in authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()]
    assert names == ["Page2 C", "Page1 A", "Page1 B"] or set(names) == {"Page1 A", "Page1 B", "Page2 C"}


def test_load_more_dedupes_repeated_urls_between_pages(authed_client, monkeypatch):
    shared = _biz("Shared Co", "https://shared.example")
    _use_paged_stub_provider(
        monkeypatch,
        [
            [shared, _biz("Unique 1", "https://u1.example")],
            [shared, _biz("Unique 2", "https://u2.example")],
        ],
    )
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()
    authed_client.post(f"/api/v1/discovery-searches/{search['id']}/load-more")

    rows = authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()
    urls = [r["website_url"] for r in rows]
    assert urls.count("https://shared.example") == 1
    assert len(rows) == 3


def test_load_more_preserves_website_filter(authed_client, monkeypatch):
    _use_paged_stub_provider(
        monkeypatch,
        [
            [_biz("Has 1", "https://h1.example"), NormalizedBusinessResult(name="None 1", website_status=WebsiteStatus.NONE)],
            [_biz("Has 2", "https://h2.example"), NormalizedBusinessResult(name="None 2", website_status=WebsiteStatus.NONE)],
        ],
    )
    search = authed_client.post(
        "/api/v1/discovery-searches", json={"industry": "Plumbing", "has_website": True}
    ).json()
    authed_client.post(f"/api/v1/discovery-searches/{search['id']}/load-more")

    names = {r["name"] for r in authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()}
    assert names == {"Has 1", "Has 2"}


def test_load_more_on_exhausted_search_returns_409(authed_client, monkeypatch):
    _use_stub_provider(monkeypatch, [_biz("Only Co", "https://only.example")])
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()
    assert authed_client.post(f"/api/v1/discovery-searches/{search['id']}/load-more").status_code == 409


def test_load_more_on_missing_search_returns_404(authed_client):
    assert authed_client.post(f"/api/v1/discovery-searches/{uuid.uuid4()}/load-more").status_code == 404


def test_load_more_provider_outage_keeps_existing_results(authed_client, monkeypatch):
    from app.integrations.discovery import registry
    from app.integrations.discovery.base import ProviderUnavailableError

    class _FlakyProvider:
        name = "flaky"

        def __init__(self):
            self.calls = 0

        def discover(self, criteria):
            self.calls += 1
            if criteria.offset == 0:
                return DiscoveryPage(results=[_biz("Page1", "https://p1.example")], has_more=True)
            raise ProviderUnavailableError("provider is down")

    monkeypatch.setattr(registry, "get_provider", lambda name: _FlakyProvider())
    search = authed_client.post("/api/v1/discovery-searches", json={"industry": "Plumbing"}).json()

    more = authed_client.post(f"/api/v1/discovery-searches/{search['id']}/load-more")
    assert more.status_code == 200
    assert more.json()["result_count"] == 1
    assert more.json()["has_more"] is False
    assert len(authed_client.get(f"/api/v1/discovery-searches/{search['id']}/results").json()) == 1
