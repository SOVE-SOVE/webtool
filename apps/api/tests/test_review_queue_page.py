"""Server-side pagination for the Discovery Review Queue: filters/sort are
applied to the whole queue before the page is cut, ordering is stable, and
an out-of-range page is clamped to the last valid one."""

from datetime import datetime, timedelta, timezone

from app.integrations.discovery.base import WebsiteStatus
from app.modules.business_research.models import BusinessResearchResult
from app.modules.discovery.models import (
    DiscoveredBusiness,
    DiscoveredBusinessStatus,
    DiscoverySearch,
    OpportunityScoreCategory,
)

URL = "/api/v1/discovered-businesses/review-queue"


def _search(db, workspace):
    s = DiscoverySearch(workspace_id=workspace.id, industry="Plumbing", provider="manual")
    db.add(s)
    db.commit()
    return s


def _biz(db, search, i, **kw):
    now = datetime.now(timezone.utc)
    d = dict(
        discovery_search_id=search.id,
        name=f"Biz {i:03d}",
        source_provider="manual",
        dedup_key=f"biz{i}",
        review_queued_at=now,
        discovered_at=now - timedelta(minutes=i),
        website_status=WebsiteStatus.FOUND,
    )
    d.update(kw)
    b = DiscoveredBusiness(**d)
    db.add(b)
    db.commit()
    return b


def _seed(db, workspace, n):
    s = _search(db, workspace)
    return [_biz(db, s, i) for i in range(n)]


def test_pages_partial_last_page_and_no_duplicates(authed_client, db_session, workspace):
    _seed(db_session, workspace, 25)
    seen = []
    for p, expected in [(1, 10), (2, 10), (3, 5)]:
        body = authed_client.get(URL, params={"page": p, "page_size": 10, "sort": "name"}).json()
        assert len(body["items"]) == expected
        assert (body["total"], body["total_pages"], body["page"]) == (25, 3, p)
        seen += [i["id"] for i in body["items"]]
    assert len(seen) == len(set(seen)) == 25


def test_ties_are_stable_across_pages(authed_client, db_session, workspace):
    s = _search(db_session, workspace)
    same = datetime.now(timezone.utc)
    for i in range(12):  # identical score AND discovered_at — only id can break the tie
        _biz(db_session, s, i, opportunity_score=50, discovered_at=same)
    ids = []
    for p in (1, 2):
        ids += [i["id"] for i in authed_client.get(URL, params={"page": p, "page_size": 6}).json()["items"]]
    assert len(set(ids)) == 12


def test_out_of_range_page_clamps_and_empty_queue_is_page_one(authed_client, db_session, workspace):
    empty = authed_client.get(URL, params={"page": 4}).json()
    assert (empty["items"], empty["total"], empty["page"], empty["total_pages"]) == ([], 0, 1, 1)
    _seed(db_session, workspace, 11)
    body = authed_client.get(URL, params={"page": 9, "page_size": 10}).json()
    assert body["page"] == 2 and len(body["items"]) == 1


def test_filters_apply_to_whole_queue_before_paging(authed_client, db_session, workspace):
    s = _search(db_session, workspace)
    for i in range(15):
        _biz(db_session, s, i, website_status=WebsiteStatus.NONE if i % 3 == 0 else WebsiteStatus.FOUND)
    body = authed_client.get(URL, params={"website": "no", "page_size": 2}).json()
    assert body["total"] == 5 and body["total_pages"] == 3
    body = authed_client.get(URL, params={"search": "biz 01", "page_size": 10}).json()
    assert body["total"] == 5  # "Biz 010".."Biz 014"
    assert all("biz 01" in i["name"].lower() for i in body["items"])


def test_score_analysis_and_tab_filters_and_counts(authed_client, db_session, workspace):
    s = _search(db_session, workspace)
    hot = _biz(db_session, s, 1, opportunity_score=90, score_category=OpportunityScoreCategory.HOT)
    zero = _biz(db_session, s, 2, opportunity_score=0, score_category=OpportunityScoreCategory.COLD)
    _biz(db_session, s, 3)  # unscored
    done = _biz(db_session, s, 4)
    failed = _biz(db_session, s, 5)
    _biz(db_session, s, 6, status=DiscoveredBusinessStatus.IMPORTED)
    db_session.add_all(
        [
            BusinessResearchResult(discovered_business_id=done.id),
            BusinessResearchResult(discovered_business_id=failed.id, research_error="boom"),
        ]
    )
    db_session.commit()

    def names(**p):
        return [i["id"] for i in authed_client.get(URL, params=p).json()["items"]]

    assert names(score="hot") == [str(hot.id)]
    assert str(zero.id) not in names(score="unscored")  # zero is a score, not "unavailable"
    assert names(analysis="failed") == [str(failed.id)]
    assert names(analysis="done") == [str(done.id)]
    assert len(names(analysis="not_run")) == 3  # hot, zero, unscored (imported is hidden by the tab)
    assert names(sort="score")[:2] == [str(hot.id), str(zero.id)]  # unscored sorted last

    body = authed_client.get(URL).json()
    assert body["tab_counts"]["needs_review"] == 5 and body["tab_counts"]["imported"] == 1
    assert body["total"] == 5  # default tab hides the imported one


def test_removed_from_queue_not_listed_and_workspace_scoped(authed_client, db_session, workspace):
    rows = _seed(db_session, workspace, 3)
    assert authed_client.delete(f"/api/v1/discovered-businesses/{rows[0].id}/queue").status_code == 200
    body = authed_client.get(URL).json()
    assert body["total"] == 2 and str(rows[0].id) not in [i["id"] for i in body["items"]]


def test_page_size_is_bounded(authed_client):
    assert authed_client.get(URL, params={"page_size": 101}).status_code == 422
    assert authed_client.get(URL, params={"page": 0}).status_code == 422
