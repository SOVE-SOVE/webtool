import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents import business_research as business_research_agent
from app.agents.business_research import BusinessResearchAgentInput
from app.modules.activity_log import service as activity_service
from app.modules.business_research.models import BusinessResearchResult
from app.modules.business_research.schemas import BusinessResearchResultRead
from app.modules.discovery.models import DiscoveredBusiness, DiscoveredBusinessStatus, DiscoverySearch
from app.modules.jobs import service as jobs_service
from app.modules.jobs.job_types import JOB_WEBSITE_QUALITY_AUDIT

# How long a research result stays "fresh enough" that re-researching the
# same business is skipped — per the "same business is not repeatedly
# researched unnecessarily" requirement. A business's public web presence
# doesn't change hour to hour; a week is long enough to avoid redundant
# fetches while still catching a business that's changed since.
RESEARCH_FRESHNESS = timedelta(days=7)


def _split(text: str) -> str | None:
    return "\n".join(text) or None


def _get_discovered_business(
    db: Session, workspace_id: uuid.UUID, discovered_business_id: uuid.UUID
) -> DiscoveredBusiness | None:
    return db.scalar(
        select(DiscoveredBusiness)
        .join(DiscoverySearch, DiscoveredBusiness.discovery_search_id == DiscoverySearch.id)
        .where(DiscoverySearch.workspace_id == workspace_id, DiscoveredBusiness.id == discovered_business_id)
    )


def run_research(
    db: Session, workspace_id: uuid.UUID, actor_id: uuid.UUID, discovered_business_id: uuid.UUID
) -> BusinessResearchResultRead | None:
    """
    Returns a fresh-enough cached result without re-fetching when one
    exists (see RESEARCH_FRESHNESS); otherwise runs the research agent
    and persists a new result. Returns None when the business doesn't
    exist in this workspace, so the route can 404.
    """
    business = _get_discovered_business(db, workspace_id, discovered_business_id)
    if business is None:
        return None

    latest = get_latest_research_result(db, discovered_business_id)
    if latest is not None and datetime.now(timezone.utc) - latest.researched_at < RESEARCH_FRESHNESS:
        return BusinessResearchResultRead.from_model(latest)

    result = business_research_agent.run(BusinessResearchAgentInput(website_url=business.website_url))
    output = result.output

    row = BusinessResearchResult(
        discovered_business_id=business.id,
        official_website_url=output.official_website_url,
        website_reachable=output.website_reachable,
        https=output.https,
        http_status=output.http_status,
        page_title=output.page_title,
        meta_description=output.meta_description,
        mobile_viewport_present=output.mobile_viewport_present,
        contact_cta_present=output.contact_cta_present,
        load_time_ms=output.load_time_ms,
        estimated_site_age=output.estimated_site_age,
        appears_template_or_placeholder=output.appears_template_or_placeholder,
        technical_issues=_split(output.technical_issues),
        social_presence=_split(output.social_presence),
        confirmed_facts=_split(output.confirmed_facts),
        inferred_facts=_split(output.inferred_facts),
        unavailable_fields=_split(output.unavailable_fields),
        research_error=output.research_error,
    )
    db.add(row)
    db.flush()

    # Carry the contact details research actually read off the site onto
    # the discovered business, so import_to_lead() has a real phone/email
    # to put on the CRM record instead of leaving the operator to go dig
    # them out of the website by hand. Only fills a blank — never
    # overwrites a value already on the row.
    if output.contact_phone and not business.phone:
        business.phone = output.contact_phone[:50]
    if output.contact_email and not business.email:
        business.email = output.contact_email[:255]
    if output.social_presence and not business.social_links:
        business.social_links = "\n".join(output.social_presence)
    if output.postal_address and not business.address:
        business.address = output.postal_address[:500]
    # Coordinates only from a real source (here: the site's own
    # schema.org GeoCoordinates) — fill only when we don't already have
    # a pair, and only when both are present.
    if (
        output.latitude is not None
        and output.longitude is not None
        and business.latitude is None
        and business.longitude is None
    ):
        business.latitude = output.latitude
        business.longitude = output.longitude

    if business.status == DiscoveredBusinessStatus.NEW:
        business.status = DiscoveredBusinessStatus.RESEARCHED

    activity_service.record(
        db,
        workspace_id=workspace_id,
        user_id=actor_id,
        entity_type="discovered_business",
        entity_id=business.id,
        action="researched",
        summary=f"Researched {business.name}"
        + (f" — flagged for review: {result.notes}" if result.flagged_for_review else ""),
    )

    db.commit()
    db.refresh(row)

    # Automation hand-off: analysis (website quality audit) runs next on
    # its own — only off a genuine new research run, not the cache-hit
    # branch above, so re-requesting research within RESEARCH_FRESHNESS
    # doesn't spam a duplicate audit for a business already through the
    # chain.
    jobs_service.enqueue(
        db,
        workspace_id=workspace_id,
        job_type=JOB_WEBSITE_QUALITY_AUDIT,
        payload={"discovered_business_id": str(business.id)},
        actor_id=actor_id,
    )

    return BusinessResearchResultRead.from_model(row)


def list_research_results(db: Session, discovered_business_id: uuid.UUID) -> list[BusinessResearchResultRead]:
    query = (
        select(BusinessResearchResult)
        .where(BusinessResearchResult.discovered_business_id == discovered_business_id)
        .order_by(BusinessResearchResult.researched_at.desc())
    )
    return [BusinessResearchResultRead.from_model(r) for r in db.scalars(query)]


def get_latest_research_result(db: Session, discovered_business_id: uuid.UUID) -> BusinessResearchResult | None:
    return db.scalar(
        select(BusinessResearchResult)
        .where(BusinessResearchResult.discovered_business_id == discovered_business_id)
        .order_by(BusinessResearchResult.researched_at.desc())
        .limit(1)
    )
