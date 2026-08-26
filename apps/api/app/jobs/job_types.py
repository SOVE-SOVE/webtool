"""
Canonical `Job.job_type` / `JobSchedule.job_type` string constants — one
place so a handler registration (`app/jobs/handlers.py`) and whatever
enqueues that job type never drift apart. Add here as each capability
gets wired to the automation engine; nothing enforces a job_type isn't a
raw string, but every enqueue call in this codebase should import from
here rather than hand-typing one.
"""

LEAD_DISCOVERY_BATCH = "lead_discovery_batch"
PROSPECT_RESEARCH = "prospect_research"
