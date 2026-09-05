"""
Phase 1 of Instagram Discovery (docs/05_DECISIONS.md): parsing
operator-provided CSV text into normalized candidates
(modules/discovery/instagram_import.py), and the service/route layer
that turns a parsed batch into a DiscoverySearch + DiscoveredBusiness
rows through the exact same ingest/dedup/review/score/CRM-import path
every other provider uses.
"""

from sqlalchemy import select

from app.integrations.discovery.base import InstagramWebsiteStatus, LocationConfidence, WebsiteStatus
from app.modules.discovery import service
from app.modules.discovery.instagram_import import parse_instagram_csv
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.discovery.schemas import InstagramImportRequest


# --- Pure CSV parsing --------------------------------------------------------


def test_parses_a_well_formed_row():
    csv_text = (
        "name,instagram_handle,category,phone,email,address,suburb,state,follower_count,"
        "last_post_date,website_status,bio,bio_link_url\n"
        "Joe's Plumbing,@joesplumbing,Plumbing,0400111222,joe@example.com,12 Smith St,"
        "Gold Coast,QLD,1500,2026-08-01,link_in_bio_only,Your local plumber,"
        "https://linktr.ee/joesplumbing\n"
    )
    result = parse_instagram_csv(csv_text)

    assert result.errors == []
    assert len(result.results) == 1
    row = result.results[0]
    assert row.name == "Joe's Plumbing"
    assert row.instagram_handle == "joesplumbing"  # leading @ stripped
    assert row.instagram_profile_url == "https://instagram.com/joesplumbing"
    assert row.instagram_follower_count == 1500
    assert row.instagram_last_post_at is not None
    assert row.instagram_website_status == InstagramWebsiteStatus.LINK_IN_BIO_ONLY
    assert row.website_status == WebsiteStatus.NONE  # mapped down — a link-in-bio page isn't an owned site
    assert row.website_url is None
    assert row.business_category == "Plumbing"
    assert row.location_confidence == LocationConfidence.APPROXIMATE  # address given, not explicitly stated


def test_quoted_field_with_comma_is_handled():
    csv_text = 'name,instagram_handle\n"Smith, Jones & Co",smithjonesco\n'
    result = parse_instagram_csv(csv_text)
    assert result.errors == []
    assert result.results[0].name == "Smith, Jones & Co"


def test_row_missing_name_and_handle_is_skipped_with_reason():
    csv_text = "name,instagram_handle,phone\n,,0400111222\n"
    result = parse_instagram_csv(csv_text)
    assert result.results == []
    assert len(result.errors) == 1
    assert result.errors[0].row_number == 2
    assert "name" in result.errors[0].reason.lower()


def test_name_falls_back_to_handle_when_missing():
    csv_text = "name,instagram_handle\n,joesplumbing\n"
    result = parse_instagram_csv(csv_text)
    assert result.results[0].name == "joesplumbing"


def test_blank_lines_are_skipped_not_treated_as_rows():
    csv_text = "name,instagram_handle\nJoe's Plumbing,joesplumbing\n\n\n"
    result = parse_instagram_csv(csv_text)
    assert len(result.results) == 1


def test_website_status_proper_website_without_url_falls_back_to_unknown():
    """Never claim a website exists without a URL to back it up."""
    csv_text = "name,website_status\nJoe's Plumbing,proper_website\n"
    result = parse_instagram_csv(csv_text)
    row = result.results[0]
    assert row.website_status == WebsiteStatus.UNKNOWN
    assert row.website_url is None


def test_website_status_proper_website_with_url_is_found():
    csv_text = "name,website_status,website_url\nJoe's Plumbing,proper_website,https://joesplumbing.com.au\n"
    result = parse_instagram_csv(csv_text)
    row = result.results[0]
    assert row.website_status == WebsiteStatus.FOUND
    assert row.website_url == "https://joesplumbing.com.au"


def test_unrecognized_website_status_defaults_to_unknown_needs_review():
    csv_text = "name,website_status\nJoe's Plumbing,????\n"
    result = parse_instagram_csv(csv_text)
    assert result.results[0].instagram_website_status == InstagramWebsiteStatus.UNKNOWN_NEEDS_REVIEW
    assert result.results[0].website_status == WebsiteStatus.UNKNOWN


def test_explicit_coordinates_are_accepted_and_confirmed():
    csv_text = "name,latitude,longitude\nJoe's Plumbing,-28.0167,153.4"
    result = parse_instagram_csv(csv_text)
    row = result.results[0]
    assert row.latitude == -28.0167
    assert row.longitude == 153.4
    assert row.location_confidence == LocationConfidence.CONFIRMED


def test_one_sided_coordinate_is_dropped_not_guessed():
    csv_text = "name,latitude,address\nJoe's Plumbing,-28.0167,12 Smith St"
    result = parse_instagram_csv(csv_text)
    row = result.results[0]
    assert row.latitude is None
    assert row.longitude is None
    assert row.location_confidence == LocationConfidence.APPROXIMATE  # falls back to the address alone


def test_no_coordinates_never_puts_a_pin_on_the_map():
    csv_text = "name,address\nJoe's Plumbing,12 Smith St"
    result = parse_instagram_csv(csv_text)
    row = result.results[0]
    assert row.latitude is None and row.longitude is None


def test_explicit_location_confidence_column_is_respected():
    csv_text = "name,address,location_confidence\nJoe's Plumbing,12 Smith St,confirmed\n"
    result = parse_instagram_csv(csv_text)
    assert result.results[0].location_confidence == LocationConfidence.CONFIRMED


def test_no_location_data_leaves_confidence_unset():
    csv_text = "name\nJoe's Plumbing\n"
    result = parse_instagram_csv(csv_text)
    assert result.results[0].location_confidence is None


def test_follower_count_handles_thousands_separator():
    csv_text = "name,follower_count\nJoe's Plumbing,\"1,234\"\n"
    result = parse_instagram_csv(csv_text)
    assert result.results[0].instagram_follower_count == 1234


def test_invalid_follower_count_is_left_null_not_erroring():
    csv_text = "name,follower_count\nJoe's Plumbing,lots\n"
    result = parse_instagram_csv(csv_text)
    assert result.results[0].instagram_follower_count is None


def test_header_matching_is_case_and_separator_insensitive():
    csv_text = "Name,Instagram Handle,Follower-Count\nJoe's Plumbing,joesplumbing,500\n"
    result = parse_instagram_csv(csv_text)
    row = result.results[0]
    assert row.name == "Joe's Plumbing"
    assert row.instagram_handle == "joesplumbing"
    assert row.instagram_follower_count == 500


def test_empty_csv_produces_no_results_or_errors():
    result = parse_instagram_csv("")
    assert result.results == []
    assert result.errors == []


def test_import_truncates_at_max_rows(monkeypatch):
    import app.modules.discovery.instagram_import as instagram_import_module

    monkeypatch.setattr(instagram_import_module, "MAX_ROWS_PER_IMPORT", 2)
    csv_text = "name\nA\nB\nC\n"
    result = parse_instagram_csv(csv_text)
    assert len(result.results) == 2
    assert result.truncated is True


# --- Service/route integration -----------------------------------------------


def _valid_csv(*, handle: str = "joesplumbing", name: str = "Joe's Plumbing") -> str:
    return (
        f"name,instagram_handle,category,phone,website_status\n"
        f"{name},{handle},Plumbing,0400111222,no_website\n"
    )


def test_import_creates_a_search_and_business(db_session, workspace, admin_user):
    result = service.import_instagram_candidates(
        db_session,
        workspace.id,
        admin_user.id,
        InstagramImportRequest(query_label="Gold Coast plumbers", csv_text=_valid_csv()),
    )

    assert result.created_count == 1
    assert result.duplicate_count == 0
    assert result.skipped_rows == []
    assert result.search.provider == "instagram_import"
    assert result.search.status == "completed"

    search = db_session.get(DiscoverySearch, result.search.id)
    assert search is not None
    business = db_session.scalar(
        select(DiscoveredBusiness).where(DiscoveredBusiness.discovery_search_id == search.id)
    )
    assert business is not None


def test_import_reports_skipped_rows(db_session, workspace, admin_user):
    csv_text = "name,instagram_handle,phone\nJoe's Plumbing,joesplumbing,\n,,0400111222\n"
    result = service.import_instagram_candidates(
        db_session, workspace.id, admin_user.id, InstagramImportRequest(csv_text=csv_text)
    )
    assert result.created_count == 1
    assert len(result.skipped_rows) == 1


def test_import_rejects_a_csv_with_no_rows(db_session, workspace, admin_user):
    try:
        service.import_instagram_candidates(
            db_session, workspace.id, admin_user.id, InstagramImportRequest(csv_text="")
        )
        assert False, "expected InvalidSearchError"
    except service.InvalidSearchError:
        pass


def test_import_dedupes_the_same_handle_within_one_csv(db_session, workspace, admin_user):
    csv_text = "name,instagram_handle\nJoe's Plumbing,joesplumbing\nJoe's Plumbing,joesplumbing\n"
    result = service.import_instagram_candidates(
        db_session, workspace.id, admin_user.id, InstagramImportRequest(csv_text=csv_text)
    )
    assert result.created_count == 1
    assert result.duplicate_count == 1


def test_imported_business_appears_in_review_queue(db_session, workspace, admin_user):
    service.import_instagram_candidates(
        db_session, workspace.id, admin_user.id, InstagramImportRequest(csv_text=_valid_csv())
    )
    items = service.list_review_items(db_session, workspace.id)
    assert any(i.name == "Joe's Plumbing" for i in items)


def test_import_route_requires_auth(client):
    res = client.post("/api/v1/discovery-searches/instagram-import", json={"csv_text": _valid_csv()})
    assert res.status_code == 401


def test_import_route_creates_and_returns_result(authed_client):
    res = authed_client.post(
        "/api/v1/discovery-searches/instagram-import",
        json={"query_label": "Test import", "csv_text": _valid_csv()},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["created_count"] == 1
    assert body["search"]["provider"] == "instagram_import"


def test_import_route_400s_on_empty_csv(authed_client):
    res = authed_client.post("/api/v1/discovery-searches/instagram-import", json={"csv_text": ""})
    assert res.status_code == 400


def test_imported_business_can_be_added_to_leads(authed_client, db_session, workspace):
    res = authed_client.post(
        "/api/v1/discovery-searches/instagram-import", json={"csv_text": _valid_csv()}
    )
    search_id = res.json()["search"]["id"]
    results = authed_client.get(f"/api/v1/discovery-searches/{search_id}/results").json()
    assert len(results) == 1
    business_id = results[0]["id"]

    approve_res = authed_client.post(f"/api/v1/discovered-businesses/{business_id}/approve")
    assert approve_res.status_code == 200
    body = approve_res.json()
    assert body["outcome"] == "imported"
    assert body["lead_id"] is not None
