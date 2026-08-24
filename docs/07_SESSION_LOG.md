# Session Log

Chronological record of Claude Code work sessions on this project.
One entry per session. Newest entries at the top.

Purpose: pick up exactly where the last session left off without
re-reading the whole codebase or re-explaining context. This is
separate from `05_DECISIONS` (architecture/design reasoning) and
separate from pipeline/lead state tracking (business data) — this file
is purely "what did an agent do in this coding session."

---

## [2026-08-24] — Automated follow-up management (detection, scheduling, snooze)

**Mode:** worktree (`follow-up-automation`)
**Merge to main after:** no — pending review; also branched from
`origin/main` at `b78eddb`, one commit behind local `main`
(`1e8fb99`), so this file didn't exist yet in the branch and was
recreated here from the template in the up-to-date checkout — expect a
merge conflict with the commit that originally added it.
**Scope touched:** `apps/api/app/modules/outreach` (service, schemas,
routes), `apps/api/tests/test_outreach.py`, `apps/web/src/lib/api.ts`,
`apps/web/src/app/dashboard/follow-ups/page.tsx`
**What happened:** Roadmap M3 already had manual follow-up
generation/buckets/resolve (`agents/follow_up.py`, `/dashboard/
follow-ups`) — the gap against "build automated follow-up management"
was that nothing scanned for leads that had gone quiet with no
follow-up scheduled at all; the operator had to already know to
generate one. Added:
- `modules/outreach/service.py::list_needs_follow_up` — deterministic
  (no LLM, same philosophy as `agents/lead_score.py`) detector that
  scans non-archived leads in the follow-up-eligible statuses
  (qualified/contacted/replied/meeting/proposal/nurture), skips any
  lead that already has a pending `FollowUp`, and flags one whose last
  real touch (sent/replied outreach, or a held meeting) is older than a
  per-status quiet threshold. Reads last contact, pipeline stage,
  meeting outcome, and previous-outreach channel to build a reason and
  a suggested channel (e.g. alternates email/phone after a stale
  contact attempt); "promised follow-up date" is covered by the
  existing overdue/due-today/upcoming buckets, which this only feeds
  leads *into* once scheduled.
- `GET /api/v1/follow-ups/needs-scheduling` + a "Needs a follow-up
  scheduled" section at the top of the follow-ups page — the daily
  queue now surfaces both what's scheduled and what's been missed
  entirely.
- `schedule_follow_up` / `POST /api/v1/leads/{id}/follow-ups/auto` —
  turns one detected candidate into a real pending `FollowUp`,
  recomputing the candidate server-side first (409 if it no longer
  qualifies, e.g. someone already replied) rather than trusting a
  stale client-side reason.
- `snooze_follow_up` / `POST /api/v1/follow-ups/{id}/snooze` — pushes
  `due_date` out by 1/3/7 days without resolving it; snoozing an
  overdue item counts from today, not the missed date. Frontend adds a
  snooze `<select>` next to "Mark done" on every bucket row.
- Nothing here sends or drafts outbound contact — detection and
  scheduling only create/adjust `FollowUp` rows for the operator to
  act on, consistent with docs/03_AGENT_RULES.md.
**Blockers/issues:** Backend logic verified end-to-end (detection
rules, channel alternation, meeting-outcome inclusion, pending-follow-
up exclusion, scheduling, the 409 guards, and both snooze paths) via a
standalone script against the real `webdesignos_test` Postgres DB
(`SessionLocal` + direct model calls), because `pytest` against that
shared DB is currently unusable — three worktrees (`follow-up-
automation`, `calendar-adapter-integration`, `email-integration`) are
running concurrently against the same `webdesignos_test` database, and
their session-scoped `create_all`/`drop_all` fixtures race each other
(confirmed: even the untouched `test_leads.py` now fails with
`UndefinedTable`/`DependentObjectsStillExist`, and an `email_sends`
table from the email-integration branch is left behind blocking
`DROP TABLE outreach_messages`). The new tests were written and added
to `tests/test_outreach.py` but need a re-run once the shared DB is
quiet, or once per-worker test databases are set up — this file-
scoped `_schema`/`_clean_tables` fixture design in `conftest.py`
isn't safe for concurrent test runs and is worth a follow-up.
Frontend `tsc --noEmit` and `eslint` both pass clean on the touched
files (had to symlink the main checkout's `node_modules` into the
worktree to get type resolution working at all — a worktree has no
`node_modules` of its own).
**Next up:** Re-run `pytest tests/test_outreach.py` once the shared
test DB is free of concurrent sessions to confirm the new tests pass
for real, not just via the standalone smoke script. Consider whether
the "needs a follow-up" detector should also feed a count into the
Overview's `needs_attention` list (`modules/dashboard/service.py`) —
deliberately left untouched this pass to keep blast radius scoped to
the outreach module.

---

## Template (copy for each new entry)

## [YYYY-MM-DD] — [Session goal, one line]
**Mode:** new session / same session / worktree
**Merge to main after:** yes / no
**Scope touched:** [e.g. apps/web/src/components, packages/ui]
**What happened:** 
**Blockers/issues:** 
**Next up:** 

---

## Example entry

## 2026-08-24 — Wire up lead-score display on prospect card
**Mode:** new session
**Merge to main after:** no — pending review
**Scope touched:** apps/web/src/components/ProspectCard, apps/api/routes/leads
**What happened:** Added lead-score badge to ProspectCard, pulling from
existing `/leads/:id/score` endpoint. Score renders but color-coding
thresholds are hardcoded — should probably live in a config.
**Blockers/issues:** No loading state while score fetches; flashes
"undefined" briefly on slow connections.
**Next up:** Fix loading state, move thresholds to config, then this is
ready to merge.

---
