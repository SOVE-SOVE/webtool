"""
The `prospect_research` job handler — Phase 7 Task 3, "Build scheduled
website research." Enqueued automatically by
app/modules/discovery/service.py::create_and_run_search for every
genuinely new (non-duplicate) `DiscoveredBusiness`, whether that search
was triggered manually or by a `lead_discovery_batch` schedule (Task 2).
Runs the same discover -> research -> analyse -> score pipeline the
operator could already trigger by hand, one step at a time, so a
provider failure on one step doesn't lose the others:

- research (business_research_service.run_research) — already caches
  for 7 days and never raises on a fetch failure (captures the error on
  the row instead), satisfying "prevent excessive repeated research" /
  "use cached results" / "handle provider failures gracefully" without
  any extra code here.
- website quality analysis (website_quality_service.run_quality_audit)
- opportunity scoring (opportunity_scoring_service.run_opportunity_score)

then, if the parent DiscoverySearch has a `min_score` configured (per
Task 2's operator-configurable "minimum score"), auto-archives a result
that scores below it — keeping the review queue focused without ever
auto-importing anything into the active pipeline (archiving is strictly
a *removal* from the default review view, never an addition anywhere).
"""

import uuid

from sqlalchemy.orm import Session

from app.modules.business_research import service as business_research_service
from app.modules.discovery import service as discovery_service
from app.modules.discovery.models import DiscoveredBusiness, DiscoverySearch
from app.modules.jobs import service as jobs_service
from app.modules.jobs.models import Job
from app.modules.opportunity_scoring import service as opportunity_scoring_service
from app.modules.website_quality import service as website_quality_service


def run_prospect_research(db: Session, job: Job) -> dict:
    business_id = uuid.UUID(job.payload["discovered_business_id"])
    business = db.get(DiscoveredBusiness, business_id)
    if business is None:
        # The discovered business (or its whole search) was deleted
        # between enqueue and pickup — nothing left to research.
        return {"skipped": "discovered business no longer exists"}

    search = db.get(DiscoverySearch, business.discovery_search_id)
    workspace_id = search.workspace_id
    actor_id = job.created_by_user_id

    summary: dict = {"discovered_business_id": str(business.id)}

    jobs_service.append_log(db, job, f"Researching {business.name}")
    try:
        research = business_research_service.run_research(db, workspace_id, actor_id, business.id)
    except Exception as exc:
        jobs_service.append_log(db, job, f"Research failed: {exc}", level="error")
        summary["research_error"] = str(exc)
        return summary

    summary["researched_at"] = research.researched_at.isoformat()
    summary["confidence"] = research.confidence
    summary["research_error"] = research.research_error

    if jobs_service.is_cancel_requested(db, job.id):
        raise jobs_service.JobCancelled("cancelled after research, before quality analysis")

    jobs_service.append_log(db, job, "Running website quality analysis")
    try:
        quality = website_quality_service.run_quality_audit(db, workspace_id, actor_id, business.id)
        summary["quality_issue_count"] = quality.issue_count if quality else None
    except Exception as exc:
        jobs_service.append_log(db, job, f"Quality analysis failed: {exc}", level="error")
        summary["quality_error"] = str(exc)

    if jobs_service.is_cancel_requested(db, job.id):
        raise jobs_service.JobCancelled("cancelled after quality analysis, before scoring")

    jobs_service.append_log(db, job, "Scoring opportunity")
    score = None
    try:
        score = opportunity_scoring_service.run_opportunity_score(db, workspace_id, actor_id, business.id)
        summary["opportunity_score"] = score.overall_score if score else None
        summary["score_category"] = score.category.value if score else None
    except Exception as exc:
        jobs_service.append_log(db, job, f"Scoring failed: {exc}", level="error")
        summary["score_error"] = str(exc)

    if score is not None and search.min_score is not None and score.overall_score < search.min_score:
        try:
            discovery_service.archive_business(db, workspace_id, actor_id, business.id)
        except discovery_service.InvalidReviewActionError:
            # Already reviewed by a human (e.g. approved/imported) between
            # scoring and here — a human decision always wins over the
            # automatic low-score archive.
            pass
        else:
            jobs_service.append_log(
                db, job, f"Archived — score {score.overall_score} below configured minimum {search.min_score}"
            )
            summary["auto_archived"] = True

    return summary
