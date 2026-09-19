"""
One-off, idempotent clean-up for scores created before failed analyses were
treated as "unavailable" (2026-09-19 — see docs/07_SESSION_LOG.md).

Every business whose latest research is a failed analysis, or whose listed
URL is a social profile, but whose latest score is still a numeric one, is
re-scored with the corrected (deterministic — no network, no LLM, no paid
call) logic. Nothing is deleted or edited in place: a new score row is
appended (history keeps the old one) and the business's cached score is
updated by the same service path a normal re-score uses.

    python -m app.modules.opportunity_scoring.remediate            # dry run
    python -m app.modules.opportunity_scoring.remediate --apply
"""

import argparse
import sys

from sqlalchemy import select

from app.db import all_models  # noqa: F401 — registers every model so relationships resolve
from app.db.session import SessionLocal
from app.integrations.website_kind import social_platform
from app.modules.business_research.models import BusinessResearchResult
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.opportunity_scoring import service
from app.modules.opportunity_scoring.models import OpportunityScoreResult


def _latest(db, model, business_id, order_col):
    return db.scalar(
        select(model).where(model.discovered_business_id == business_id).order_by(order_col.desc()).limit(1)
    )


def find_stale(db) -> list[tuple[DiscoveredBusiness, str]]:
    stale: list[tuple[DiscoveredBusiness, str]] = []
    for business in db.scalars(select(DiscoveredBusiness).where(DiscoveredBusiness.website_url.is_not(None))):
        score = _latest(db, OpportunityScoreResult, business.id, OpportunityScoreResult.scored_at)
        if score is None or score.overall_score is None:
            continue  # never scored, or already unavailable
        research = _latest(db, BusinessResearchResult, business.id, BusinessResearchResult.researched_at)
        if research is None:
            continue
        if social_platform(business.website_url):
            stale.append((business, "social profile listed as website"))
        elif research.research_error or research.website_reachable is False:
            stale.append((business, "failed analysis scored as a website finding"))
    return stale


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually re-score (default: dry run)")
    parser.add_argument("--limit", type=int, default=None, help="only handle the first N (for a sample)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        stale = find_stale(db)
        if args.limit:
            stale = stale[: args.limit]
        print(f"{len(stale)} businesses have a stale numeric score")
        for business, why in stale[:10]:
            print(f"  - {business.name} (cached score {business.opportunity_score}): {why}")
        if not args.apply:
            print("dry run — pass --apply to re-score")
            return 0
        for business, _ in stale:
            search = db.get(DiscoverySearch, business.discovery_search_id)
            service.run_opportunity_score(db, search.workspace_id, None, business.id)
        print(f"re-scored {len(stale)}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
