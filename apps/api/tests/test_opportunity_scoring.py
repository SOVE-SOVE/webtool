"""
Task 5 of Phase 2 ("Lead Intelligence"): transparent opportunity
scoring. Every score must be explainable — factors, positive/negative
signals, confidence, and a plain-language reason — and never an
arbitrary black-box number. Covers several distinct prospect scenarios
(no website, broken website, clean site, problem-riddled site,
low-confidence/insufficient-evidence) directly against the agent, plus
the service/route layer (requires research, persists, caches onto the
discovered business, advances status).
"""

import uuid

from app.agents import opportunity_score as opportunity_score_agent
from app.agents.opportunity_score import OpportunityScoreInput
from app.integrations.discovery.base import InstagramWebsiteStatus
from app.modules.business_research.models import BusinessResearchResult
from app.modules.discovery.models import (
    DiscoveredBusiness,
    DiscoveredBusinessStatus,
    DiscoverySearch,
    OpportunityScoreCategory,
)


def _make_search(db_session, workspace, **overrides) -> DiscoverySearch:
    defaults = dict(workspace_id=workspace.id, industry="Plumbing", provider="manual")
    defaults.update(overrides)
    search = DiscoverySearch(**defaults)
    db_session.add(search)
    db_session.commit()
    db_session.refresh(search)
    return search


def _make_discovered_business(db_session, search, **overrides) -> DiscoveredBusiness:
    defaults = dict(
        discovery_search_id=search.id,
        name="Gold Coast Plumbing Co",
        website_url="https://gcplumbing.example",
        source_provider="manual",
        dedup_key="gold coast plumbing co||",
    )
    defaults.update(overrides)
    business = DiscoveredBusiness(**defaults)
    db_session.add(business)
    db_session.commit()
    db_session.refresh(business)
    return business


def _make_research(db_session, business, **overrides) -> BusinessResearchResult:
    defaults = dict(
        discovered_business_id=business.id,
        official_website_url=business.website_url,
        website_reachable=True,
        https=True,
        mobile_viewport_present=True,
        load_time_ms=1200,
        contact_cta_present=True,
        page_title="Gold Coast Plumbing Co",
        meta_description="Local plumbers",
        social_presence="https://facebook.com/gcplumbing",
    )
    defaults.update(overrides)
    research = BusinessResearchResult(**defaults)
    db_session.add(research)
    db_session.commit()
    db_session.refresh(research)
    return research


# --- Agent: prospect scenarios -----------------------------------------------


def test_no_website_scores_hot_with_full_confidence():
    result = opportunity_score_agent.run(OpportunityScoreInput(has_website_on_record=False))

    assert result.output.category == "hot"
    assert result.output.confidence == 1.0
    assert result.output.overall_score == 85
    assert len(result.output.factors) == 1
    assert "No existing website found" in result.output.positive_signals
    assert result.output.recommendation_reason


def test_unreachable_website_scores_hot_and_flags_for_review():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(has_website_on_record=True, website_reachable=False, research_error="Timeout")
    )

    assert result.output.category == "hot"
    assert result.output.overall_score == 90
    assert "Existing website appears to be down or broken" in result.output.negative_signals
    assert result.flagged_for_review is True  # unreachable is worth a manual recheck


def test_clean_fully_measured_site_scores_cold():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(
            has_website_on_record=True,
            website_reachable=True,
            https=True,
            mobile_viewport_present=True,
            load_time_ms=900,
            contact_cta_present=True,
            page_title="Real Business",
            meta_description="A real description",
            social_presence_count=2,
            evidence_completeness=1.0,
        )
    )

    assert result.output.category == "cold"
    assert result.output.factors == []
    assert result.output.confidence == 1.0
    assert "passed every check" in result.output.recommendation_reason


def test_problem_riddled_site_scores_hot():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(
            has_website_on_record=True,
            website_reachable=True,
            https=False,
            mobile_viewport_present=False,
            load_time_ms=6000,
            contact_cta_present=False,
            appears_template_or_placeholder=True,
            page_title=None,
            meta_description=None,
            social_presence_count=0,
            evidence_completeness=1.0,
        )
    )

    assert result.output.category == "hot"
    assert result.output.overall_score == 80  # capped
    assert len(result.output.factors) >= 6
    assert len(result.output.negative_signals) >= 6


def test_moderate_problems_scores_warm():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(
            has_website_on_record=True,
            website_reachable=True,
            https=False,
            mobile_viewport_present=True,
            load_time_ms=900,
            contact_cta_present=True,
            page_title="Some Business",
            meta_description="Some description",
            social_presence_count=1,
            evidence_completeness=1.0,
        )
    )

    assert result.output.category == "warm"


def test_low_evidence_completeness_forces_review_regardless_of_score():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(
            has_website_on_record=True,
            website_reachable=True,
            https=None,
            mobile_viewport_present=None,
            load_time_ms=None,
            contact_cta_present=None,
            page_title="Something",
            meta_description="Something",
            social_presence_count=1,
            evidence_completeness=0.0,
        )
    )

    assert result.output.category == "review"
    assert result.output.confidence < 0.6
    assert result.flagged_for_review is True


def test_every_factor_traces_a_point_change():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(
            has_website_on_record=True, website_reachable=True, https=False, mobile_viewport_present=False,
        )
    )
    for factor in result.output.factors:
        assert factor.points > 0
        assert factor.explanation
        assert factor.direction == "positive"


def test_score_never_arbitrary_every_output_field_present():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(has_website_on_record=True, website_reachable=True, https=False)
    )
    output = result.output
    assert isinstance(output.overall_score, int)
    assert output.category in ("hot", "warm", "cold", "review")
    assert 0.0 <= output.confidence <= 1.0
    assert isinstance(output.positive_signals, list)
    assert isinstance(output.negative_signals, list)
    assert isinstance(output.factors, list)
    assert output.recommendation_reason


# --- Service/route ------------------------------------------------------------


def test_score_requires_research_first(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/scores")
    assert res.status_code == 400


def test_score_returns_404_for_missing_business(authed_client):
    res = authed_client.post(f"/api/v1/discovered-businesses/{uuid.uuid4()}/scores")
    assert res.status_code == 404


def test_score_persists_caches_onto_business_and_advances_status(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search, status=DiscoveredBusinessStatus.AUDITED)
    _make_research(db_session, business, https=False)

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/scores")

    assert res.status_code == 201
    body = res.json()
    assert body["overall_score"] > 0
    assert body["category"] in ("hot", "warm", "cold", "review")

    db_session.refresh(business)
    assert business.opportunity_score == body["overall_score"]
    assert business.score_category == OpportunityScoreCategory(body["category"])
    assert business.status == DiscoveredBusinessStatus.SCORED


def test_score_for_business_with_no_website(authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search, website_url=None)
    _make_research(
        db_session, business, official_website_url=None, website_reachable=None, https=None,
        mobile_viewport_present=None, contact_cta_present=None, page_title=None, meta_description=None,
        social_presence=None,
    )

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/scores")

    assert res.status_code == 201
    body = res.json()
    assert body["overall_score"] == 85
    assert body["category"] == "hot"





# --- Phase 1 of Instagram Discovery: contactability + confirmed
# Instagram-only-presence bonuses on the *existing* engine ------------------


def test_no_bonuses_when_neither_signal_present_matches_prior_behavior():
    """A business with no phone/email on record and not Instagram-sourced
    (both new fields default False) must score exactly as it did before
    these bonuses existed — no regression for every existing Brave/Places row."""
    result = opportunity_score_agent.run(OpportunityScoreInput(has_website_on_record=False))
    assert result.output.overall_score == 85
    assert len(result.output.factors) == 1


def test_contactable_no_website_business_scores_higher():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(has_website_on_record=False, has_contact_info=True)
    )
    assert result.output.overall_score == 90  # 85 + 5
    factor_names = {f.factor for f in result.output.factors}
    assert "contactable" in factor_names
    assert "Contactable via phone or email" in result.output.positive_signals


def test_confirmed_instagram_only_presence_scores_higher():
    result = opportunity_score_agent.run(
        OpportunityScoreInput(has_website_on_record=False, confirmed_instagram_only_presence=True)
    )
    assert result.output.overall_score == 90  # 85 + 5
    factor_names = {f.factor for f in result.output.factors}
    assert "instagram_only_presence" in factor_names
    assert "Confirmed to operate with no owned website" in result.output.positive_signals


def test_both_phase1_bonuses_combine_and_cap_at_100():
    # Unreachable-website base (90) + both bonuses (5 + 5) lands exactly
    # on the cap — a real boundary case, not just headroom that's never hit.
    result = opportunity_score_agent.run(
        OpportunityScoreInput(
            has_website_on_record=True,
            website_reachable=False,
            has_contact_info=True,
            confirmed_instagram_only_presence=True,
        )
    )
    assert result.output.overall_score == opportunity_score_agent.OVERALL_CAP == 100


def test_clean_site_issue_summary_excludes_phase1_bonuses():
    """The 'N concrete issue(s)' summary is about site problems, not the
    phase-1 bonuses — a site with zero real issues but a contactable
    business must still say it passed every check."""
    result = opportunity_score_agent.run(
        OpportunityScoreInput(
            has_website_on_record=True,
            website_reachable=True,
            https=True,
            mobile_viewport_present=True,
            load_time_ms=900,
            contact_cta_present=True,
            page_title="Real Business",
            meta_description="A real description",
            social_presence_count=2,
            has_contact_info=True,
        )
    )
    assert "passed every check" in result.output.recommendation_reason
    assert len(result.output.factors) == 1  # only the contactability bonus, no "issues"


def test_run_opportunity_score_picks_up_contact_info_and_instagram_status(
    authed_client, db_session, workspace
):
    search = _make_search(db_session, workspace, provider="instagram_import")
    business = _make_discovered_business(
        db_session,
        search,
        website_url=None,
        phone="0400 000 000",
        instagram_website_status=InstagramWebsiteStatus.LINK_IN_BIO_ONLY,
        source_provider="instagram_import",
    )
    _make_research(
        db_session,
        business,
        official_website_url=None,
        website_reachable=None,
        https=None,
        mobile_viewport_present=None,
        contact_cta_present=None,
        page_title=None,
        meta_description=None,
        social_presence=None,
    )

    res = authed_client.post(f"/api/v1/discovered-businesses/{business.id}/scores")

    assert res.status_code == 201
    body = res.json()
    assert body["overall_score"] == 95  # 85 + contactable(5) + instagram_only_presence(5)
    factor_names = {f["factor"] for f in body["factors"]}
    assert {"contactable", "instagram_only_presence"} <= factor_names


def test_list_scores_workspace_scoped(authed_client, other_authed_client, db_session, workspace):
    search = _make_search(db_session, workspace)
    business = _make_discovered_business(db_session, search)
    _make_research(db_session, business)
    authed_client.post(f"/api/v1/discovered-businesses/{business.id}/scores")

    mine = authed_client.get(f"/api/v1/discovered-businesses/{business.id}/scores").json()
    assert len(mine) == 1

    other = other_authed_client.get(f"/api/v1/discovered-businesses/{business.id}/scores")
    assert other.status_code == 404
