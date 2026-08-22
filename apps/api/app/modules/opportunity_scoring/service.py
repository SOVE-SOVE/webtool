import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import opportunity_score as opportunity_score_agent
from app.agents.opportunity_score import OpportunityScoreInput
from app.modules.activity_log import service as activity_service
from app.modules.business_research.models import BusinessResearchResult
from app.modules.discovery.models import (
    DiscoveredBusiness,
    DiscoveredBusinessStatus,
    DiscoverySearch,
    OpportunityScoreCategory,
)
from app.modules.opportunity_scoring.models import OpportunityScoreResult
from app.modules.opportunity_scoring.schemas import OpportunityScoreResultRead

# The signals evidence_completeness is measured over — see
# OpportunityScoreInput.evidence_completeness. Deliberately the same
# four the reachable-website branch of agents/opportunity_score.py
# actually scores on, so "how much of this did we really measure" means
# exactly what it says.
_CORE_SIGNAL_COUNT = 4

# Only a business that hasn't already been through a human decision
# advances to SCORED on scoring — mirrors the "only advance a status
# genuinely behind" contract used throughout leads/service.py and
# website_quality/service.py.
_PRE_SCORE_STATUSES = (
    DiscoveredBusinessStatus.NEW,
    DiscoveredBusinessStatus.RESEARCHED,
    DiscoveredBusinessStatus.AUDITED,
)


class NoResearchAvailableError(ValueError):
    """Raised when scoring is requested before any research exists —
    see run_opportunity_score."""


def _get_discovered_business(
    db: Session, workspace_id: uuid.UUID, discovered_business_id: uuid.UUID
) -> DiscoveredBusiness | None:
    return db.scalar(
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id == discovered_business_id)
    )


def _get_latest_research(db: Session, discovered_business_id: uuid.UUID) -> BusinessResearchResult | None:
    return db.scalar(
        select(BusinessResearchResult)
        .where(BusinessResearchResult.discovered_business_id == discovered_business_id)
        .order_by(BusinessResearchResult.researched_at.desc())
        .limit(1)
    )


def _social_presence_count(research: BusinessResearchResult) -> int:
    if not research.social_presence:
        return 0
    return len([line for line in research.social_presence.splitlines() if line.strip()])


def _evidence_completeness(research: BusinessResearchResult) -> float:
    core_signals = (
        research.https,
        research.mobile_viewport_present,
        research.load_time_ms,
        research.contact_cta_present,
    )
    known = sum(1 for signal in core_signals if signal is not None)
    return known / _CORE_SIGNAL_COUNT


def _split(items: list[str]) -> str | None:
    return "\n".join(items) or None


def run_opportunity_score(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, discovered_business_id: uuid.UUID
) -> OpportunityScoreResultRead | None:
    """Returns None (route 404s) when the business doesn't exist in this
    workspace; raises NoResearchAvailableError (route 400s) when it
    exists but has never been researched — scoring reads research's
    signals, it doesn't fetch the site itself."""
    business = _get_discovered_business(db, workspace_id, discovered_business_id)
    if business is None:
        return None

    research = _get_latest_research(db, discovered_business_id)
    if research is None:
        raise NoResearchAvailableError("No research available for this business yet — run research first")

    result = opportunity_score_agent.run(
        OpportunityScoreInput(
            has_website_on_record=bool(business.website_url),
            website_reachable=research.website_reachable,
            research_error=research.research_error,
            https=research.https,
            mobile_viewport_present=research.mobile_viewport_present,
            load_time_ms=research.load_time_ms,
            contact_cta_present=research.contact_cta_present,
            appears_template_or_placeholder=research.appears_template_or_placeholder,
            page_title=research.page_title,
            meta_description=research.meta_description,
            social_presence_count=_social_presence_count(research),
            evidence_completeness=_evidence_completeness(research),
        )
    )
    output = result.output

    score_row = OpportunityScoreResult(
        discovered_business_id=business.id,
        overall_score=output.overall_score,
        category=OpportunityScoreCategory(output.category),
        confidence=output.confidence,
        positive_signals=_split(output.positive_signals),
        negative_signals=_split(output.negative_signals),
        factors=[f.model_dump() for f in output.factors],
        recommendation_reason=output.recommendation_reason,
    )
    db.add(score_row)
    db.flush()

    # Cached onto the business itself for fast list/filter — see
    # DiscoveredBusiness.opportunity_score's docstring.
    business.opportunity_score = output.overall_score
    business.score_category = score_row.category
    if business.status in _PRE_SCORE_STATUSES:
        business.status = DiscoveredBusinessStatus.SCORED

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovered_business",
        entity_id=business.id,
        action="scored",
        summary=f"Opportunity score for {business.name}: {output.overall_score} ({output.category.upper()})",
    )

    db.commit()
    db.refresh(score_row)
    return OpportunityScoreResultRead.from_model(score_row)


def list_score_results(db: Session, discovered_business_id: uuid.UUID) -> list[OpportunityScoreResultRead]:
    query = (
        select(OpportunityScoreResult)
        .where(OpportunityScoreResult.discovered_business_id == discovered_business_id)
        .order_by(OpportunityScoreResult.scored_at.desc())
    )
    return [OpportunityScoreResultRead.from_model(r) for r in db.scalars(query)]
