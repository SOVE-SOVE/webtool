# Session Log

Chronological record of Claude Code work sessions on this project.
One entry per session. Newest entries at the top.

Purpose: pick up exactly where the last session left off without
re-reading the whole codebase or re-explaining context. This is
separate from `05_DECISIONS` (architecture/design reasoning) and
separate from pipeline/lead state tracking (business data) — this file
is purely "what did an agent do in this coding session."

---

## 2026-08-25 — Phase 3: sales pipeline kanban over existing LeadStatus
**Mode:** same session (background job)
**Merge to main after:** yes — committed to main as `feat: build sales pipeline` (5570d82)
**Scope touched:** apps/api/app/modules/pipeline, apps/api/app/modules/leads/routes.py, apps/api/alembic/versions, apps/web/src/app/dashboard/pipeline, apps/web/src/app/dashboard/leads/[id], apps/web/src/lib/{api,pipeline}.ts
**What happened:** Added a kanban board over the existing `LeadStatus`
enum rather than introducing a new stage-key set (LeadStatus already
is the pipeline per the 2026-08-16 decision). New `pipeline_stage_configs`
table (per-workspace label/order/won-lost, lazily seeded with defaults),
`GET/PATCH /api/v1/pipeline/stages`, `GET /api/v1/leads/{id}/pipeline-events`
(read access to the already-recorded `PipelineEvent` history), a
drag-and-drop `/dashboard/pipeline` board, and a stage-history section on
the lead detail page. 14 new backend tests + frontend unit tests for the
client wiring and pure board logic (`lib/pipeline.ts`).
**Blockers/issues:** This machine had several *other* concurrent Claude
Code sessions actively running pytest against the same shared local
`webdesignos_test` Postgres database while this session worked — one
of them repeatedly ran `DROP DATABASE webdesignos_test; CREATE DATABASE
...` mid-run. That produced a wall of unrelated failures (`UndefinedTable`,
`AdminShutdown`, `DependentObjectsStillExist`) that looked like a
regression but weren't — confirmed by running the new/related test files
in isolation repeatedly (14/14, then 39/39, then 64/64, all clean) while
the full-suite run kept getting corrupted by the concurrent DB resets.
Frontend: `tsc --noEmit`, `eslint`, `vitest run` (53/53), and `next build`
all clean. Could not get one uncontaminated full backend `pytest -q` run
in this session — a real gap, not a shrug: if you're reading this before
trusting the suite as green, re-run it when no other session is using
`webdesignos_test` (`SELECT count(*) FROM pg_stat_activity WHERE
datname='webdesignos_test'` should be near-zero first). `git status` also
showed `main` had diverged from `origin/main` by the time this committed
(another session pushed) — left unresolved/unmerged deliberately, not
mine to reconcile without being asked.
**Next up:** Re-run the full backend suite once the shared test DB is
quiet, as a final sanity check. Reconcile local `main` with `origin/main`
(diverged, 1 commit each side) if/when asked. Same milestone still has:
scheduled/recurring discovery (M7), a second discovery provider, and
Phase 4 (whatever's next) — none of which this session touched.

---

## 2026-08-26 — Backend suite sanity check + overdue-follow-up timezone fix
**Mode:** same session
**Merge to main after:** yes
**Scope touched:** apps/api/app/modules/dashboard/service.py
**What happened:** Confirmed the shared `webdesignos_test` Postgres DB was
quiet (`pg_stat_activity` showed only the checking connection itself),
then ran the full backend suite the 2026-08-25 entry flagged as never
having gotten a clean run: 567 passed, 1 failed, with none of the prior
`UndefinedTable`/`AdminShutdown` contamination noise — confirms that
suite is genuinely green modulo the one real bug found. The failure
(`test_dashboard.py::test_overdue_follow_up_surfaces_with_its_suggested_action`)
was a pre-existing latent bug, not something Phase 3 introduced: `get_overview`
computed `today` from `datetime.now(timezone.utc).date()`, but
`FollowUp.due_date` is a plain date the operator picks in their own
(local) timezone — on this UTC+10 machine that mismatch silently shifted
the overdue-days count by one for roughly half of every day. Fixed by
deriving `today` from local time (`datetime.now().astimezone().date()`)
instead; every other date/time comparison on the dashboard page compares
against tz-aware `now`, which stays UTC correctly. Re-ran
`test_dashboard.py` (18/18) then the full suite again: 568/568 passed.
**Blockers/issues:** `git status` now shows local `main` diverged from
`origin/main` by 1 commit locally vs. **13** on the remote (was 1-vs-1 as
of the 2026-08-25 entry) — the gap has widened, still unreconciled,
still not resolved without being asked.
**Next up:** Reconcile local `main` with `origin/main` (now 1/13
diverged) when asked. M7 still has scheduled/recurring discovery and a
second `DiscoveryProvider` open; Phase 4 scope still undefined.

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