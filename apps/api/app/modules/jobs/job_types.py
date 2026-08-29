"""
Job `job_type` string constants — the shared vocabulary between every
service module that enqueues a job and `app/jobs/handlers.py`, which
registers a handler for each one. Kept as plain strings in their own
module (not inside `handlers.py`) so a domain service (e.g.
`modules/discovery/service.py`) can enqueue a job without importing the
handler registry itself — `handlers.py` imports the domain services, so
the domain services importing it back would be circular.
"""

JOB_DISCOVERY_SEARCH = "discovery_search"
JOB_BUSINESS_RESEARCH = "business_research"
JOB_WEBSITE_QUALITY_AUDIT = "website_quality_audit"
JOB_OPPORTUNITY_SCORE = "opportunity_score"
JOB_OUTREACH_DRAFT = "outreach_draft"
JOB_FOLLOW_UP_DRAFT = "follow_up_draft"
JOB_WEBSITE_GENERATE = "website_generate"
JOB_QA_REPORT = "qa_report"

# Default cadence for a recurring discovery search that doesn't specify
# its own interval — daily, per docs/04_ROADMAP.md M7's "scheduled/
# recurring discovery runs" gap. An operator can pick something else at
# schedule time; this is only the fallback.
DEFAULT_DISCOVERY_INTERVAL_HOURS = 24
