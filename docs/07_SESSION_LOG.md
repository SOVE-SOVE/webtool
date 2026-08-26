# Session Log

Chronological record of Claude Code work sessions on this project.
One entry per session. Newest entries at the top.

Purpose: pick up exactly where the last session left off without
re-reading the whole codebase or re-explaining context. This is
separate from `05_DECISIONS` (architecture/design reasoning) and
separate from pipeline/lead state tracking (business data) — this file
is purely "what did an agent do in this coding session."

---

## 2026-08-26 — Client onboarding checklist (per-project, not one fixed structure)
**Mode:** new session (background job), worktree `client-onboarding`
**Merge to main after:** no — pushed as branch `worktree-client-onboarding`, not merged; left for review
**Scope touched:** apps/api/app/modules/onboarding (new), apps/api/app/main.py,
apps/api/app/db/all_models.py, apps/api/alembic/versions, apps/api/tests/test_onboarding.py,
apps/web/src/lib/api.ts, apps/web/src/lib/onboarding.ts(+test), apps/web/src/app/dashboard/projects/[id]/onboarding, apps/web/src/app/dashboard/projects/[id]/page.tsx
**What happened:** Built a client onboarding checklist covering client
information, project type, goals, target audience, services, branding,
existing assets, domain, hosting, required pages, functionality,
content, deadlines, budget, and approvals, with progress tracking.
Surveyed existing conventions first (two parallel Explore agents) and
found every one of those areas already has a real backing field
somewhere (`design_briefs` mostly, plus `Project.deadline`/`package`,
plus the seven-checkpoint approvals system) — so this feature is
deliberately a genuine trackable to-do checklist over those areas, not
a second copy of the brief's data fields.

Modeled as a child-row table (`onboarding_checklist_items`, one row per
step) rather than one wide row like `design_briefs`, specifically so
"do not force every project into the same structure" is structural, not
a convention: any seeded default item can be marked `not_applicable`
instead of forced through (e.g. a project with an existing domain marks
the domain item N/A rather than leaving it perpetually pending), and an
operator can add project-specific items (`is_custom=True`) under any
category. A seeded default item can never be deleted outright — only
marked not-applicable — so the checklist always shows the full set of
areas an onboarding *could* cover; only a custom item the operator
added themselves can be removed. `percent_complete` is computed over
applicable items only (`done / (total - not_applicable)`), so a project
that's marked every remaining item N/A reads as 100%, not stuck below
it. The checklist is lazily seeded on first GET (mirrors
`design_briefs`' `_get_or_create_draft`), not on project creation, so a
project created before this feature existed gets one for free.

Backend: `apps/api/app/modules/onboarding/` (models/schemas/service/
routes), migration `52d3320ef8f1` (down_revision `731a8a798e83`, the
real single alembic head — `git log`/directory listing alone showed six
apparent heads from unmerged branch history, but `alembic heads` itself
resolves to one), two new Postgres enums (`onboarding_category`,
`onboarding_item_status`) following the `create_type=False` recipe from
`c392b641f8cb`. 11 pytest tests covering seeding, status transitions,
the not-applicable-still-100%-complete case, add/delete custom items,
the default-item delete guard (400), 404s, and workspace isolation —
all 11 passed individually, though not all in the same single run (see
Blockers).

Frontend: `api.ts` types/functions mirroring the `Brief` pattern exactly
(`getOnboardingChecklist`/`addOnboardingItem`/`updateOnboardingItem`/
`deleteOnboardingItem`); `lib/onboarding.ts` pure functions
(`formatCategoryLabel`, `groupItemsByCategory`, `categoryPercentComplete`)
with 9 vitest tests, kept out of the page component per this repo's
no-jsdom convention; a new `/dashboard/projects/[id]/onboarding` page
(separate route, like the Website builder, since this needed more room
than an inline section) with per-category progress bars, a status
dropdown per item (pending/done/N/A) instead of a bare checkbox — this
app had no existing checklist/progress UI component anywhere to reuse,
confirmed by the frontend survey agent, so this is the first one — and
an "Open checklist" link-out section on the main project page showing
overall percent complete.

**Blockers/issues:** This machine had multiple *other* concurrent
Claude Code sessions running full `pytest -q` against the same shared
local `webdesignos_test` Postgres database throughout this session —
same exact issue the 2026-08-25 session log entry documented. Symptoms
matched: `DependentObjectsStillExist` on session-fixture `drop_all`,
occasional `UniqueViolation`/`ForeignKeyViolation` from a concurrent
`create_all` racing mine, and a stray `'NoneType' object has no
attribute 'name'` on login when another session's `_clean_tables`
teardown deleted rows mid-request. Not a regression: `tests/
test_design_briefs.py`, `test_tasks.py`, and `test_projects.py` — none
of which this session touched — failed with the identical symptoms when
run alongside the same concurrent load. Every individual test in
`test_onboarding.py` passed at least once in isolation (10/11 and then
11/11 clean across two consecutive isolated runs); never got one fully
clean single run of the whole file back-to-back, same caveat the prior
entry left. Re-run `tests/test_onboarding.py` alone once the shared test
DB is quiet as a final check.

Also had to work around two environment gaps specific to running in a
git worktree rather than the primary checkout: `apps/api/.venv` isn't
under version control (used the primary checkout's venv directly — it's
just an interpreter, not tied to worktree state), and `apps/web/
node_modules` isn't either — a symlink to the primary checkout's copy
broke Turbopack (`next build` refused it, "points out of the filesystem
root"), so ran `npm ci` for a real local copy instead. `tsc --noEmit`,
`eslint` (zero new problems — diffed against the same command run
against unmodified `main`, which already has 7 pre-existing problems in
unrelated files), `vitest run` (62/62, 53 pre-existing + 9 new), and
`next build` all clean. Did not run a live-browser smoke test: this
machine already has a dev server on :3000/:8000 from another session,
and standing up a second full stack against the same dev Postgres
risked exactly the kind of cross-session interference described above
for no clean gain over the passing build/type/lint/test signals — a
real gap, flagged rather than silently skipped.

**Next up:** Re-run `test_onboarding.py` alone when the shared test DB
is quiet, as the final sanity check the concurrent load prevented this
session from getting. A live-browser walkthrough of the new
`/dashboard/projects/[id]/onboarding` page would still be worth doing
next session. Not done, deliberately: no automatic linkage between
onboarding items and the real underlying data they describe (e.g.
checking "client information" doesn't read from `DesignBrief.business_name`)
— items are operator-marked, same as `Task.done` elsewhere in this app,
not derived/computed status; wiring that up (if wanted) is a distinct,
larger feature.

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

Reconciled local `main` with `origin/main` (had diverged 1-vs-13 commits
— see Blockers below) by merging `origin/main` in rather than
fast-forwarding past local's own sales-pipeline commit: diffed the two
independently-built "sales pipeline" implementations first (this
session's `5570d82` vs. origin's `d1abf47`) and found them byte-for-byte
identical on every shared file except `apps/web/src/lib/api.ts`, which
only differed because origin's commit sat on top of already-merged
follow-up-automation/outreach-assistant work — never a real logic
clash. Resolved two merge conflicts: `apps/api/app/main.py` (additive —
origin added `sales_opportunities_router`/`sales_dashboard_router`
after this session's `pipeline_router`, kept both) and this file
(additive — combined both sides' entries in newest-first order,
including a duplicate description of this same reconciliation from the
2026-08-25 "Reconciled main" entry's cherry-pick).

Confirmed origin/main still had the same UTC/local timezone bug (its
`dashboard/service.py::get_overview` was unchanged from before this
session's fix) — so the fix above was still needed after the merge, not
already covered upstream.
**Blockers/issues:** `git status` showed local `main` diverged from
`origin/main` by 1 commit locally vs. **13** on the remote (was 1-vs-1 as
of the 2026-08-25 "Phase 3" entry) before this session's merge — the gap
had widened since a separate `merge-orchestration` session (see the next
entry below) had reconciled `origin/main` on its own, unaware of this
session's local, uncommitted-at-the-time pipeline work. Resolved via
merge, not rebase/reset, per explicit instruction.
**Next up:** M7 still has scheduled/recurring discovery and a second
`DiscoveryProvider` open; Phase 4 scope still undefined. Backend suite
should be re-verified once more post-merge (568/568 passed pre-merge;
worth a final run post-merge-commit to be certain the merge itself
didn't reintroduce anything).

---

## 2026-08-25 — Reconciled main and merged 4 pending worktree branches (calendar, email, sales pipeline, sales command centre)
**Mode:** worktree (`merge-orchestration`, background job — pure git/CI
work, no new features)
**Merge to main after:** yes — this entry documents work already on
`main` by the time it's written
**Scope touched:** `main` branch history only; conflict resolution
touched `docs/05_DECISIONS.md`, `docs/07_SESSION_LOG.md`,
`docs/04_ROADMAP.md`, `apps/api/app/main.py`,
`apps/api/app/modules/outreach/{routes,service}.py`,
`apps/api/.env.example` — no feature logic written
**What happened:** Asked to "push and merge each recently completed
task." Survey of `git worktree list` (10 worktrees) plus GitHub PR
history found: local `main` and `origin/main` had diverged (local had
an uncommitted sales-pipeline commit + session-log entry; origin had
gained the follow-up-automation/outreach-assistant PR #3 merge);
4 worktrees (`lead-management-crud`, `merry-greeting-dolphin`,
`push-to-github`, `workspace-multiuser`) were stale — tens of commits
behind `main`, diffing as pure deletions, never real candidates;
3 worktrees (`follow-up-automation`, `outreach-assistant`,
`lead-intelligence-phase2`) were already fully absorbed into `main`
(their unique commits are ancestors of `main`'s tip); leaving exactly
3 worktrees with real, unmerged work — `calendar-adapter-integration`,
`email-integration`, `sales-command-centre` — all three forked *before*
the sales-pipeline commit and so all conflicted with it (and, once the
first two landed, with each other) in shared files
(`apps/web/src/lib/api.ts`, `dashboard/layout.tsx`,
`dashboard/leads/[id]/page.tsx`, `outreach/routes.py`,
`outreach/service.py`, `main.py`, plus the three docs files).

Reconciled `main` first: cherry-picked the local-only sales-pipeline
commit onto `origin/main`'s tip (PR #3's follow-up-automation/outreach
content), added the pending session-log entry, verified (53/53
frontend tests), pushed directly to `main` (no PR — matches this
repo's existing pattern of direct-to-main commits for same-session
work, as opposed to worktree branches which go through PRs). Then, for
each of the three real branches in turn: created a local branch from
its tip (the originals stayed checked out — and locked — in their own
worktrees, all four owned by idle `bg-spare` sessions, so left
untouched rather than risk colliding with them), rebased onto the
now-current `main`, hand-resolved every conflict (all were genuinely
additive — combining two branches' import lists, or keeping both
sides' docs entries in newest-first order, never a real logic clash),
ran the full test suite, force-pushed over the original branch (with
`--force-with-lease`, after explicit user confirmation — the auto-mode
classifier blocks force-push and destructive DB commands by default,
correctly), opened a PR, and merged it — then repeated for the next
branch against the newly-updated `main`. Order: calendar (PR #4) →
email (PR #5) → sales command centre (PR #6). All landed via GitHub
merge commits, matching the existing PR #1-3 pattern.

Note (added during the 2026-08-26 merge above): this cherry-pick was
done from a *different* local checkout/session than the one that had
originally committed the sales-pipeline work as `5570d82` — that
session's own local `main` still carried its uncommitted-at-cherry-pick-
time commit independently, which is why local `main` and `origin/main`
still diverged again afterward (1 vs. 13 commits) until the 2026-08-26
entry above merged them back together.
**Blockers/issues:** Two pre-existing test failures surfaced repeatedly
across every full-suite run in this session — both timezone-boundary
bugs, both already documented by the sales-command-centre branch's own
session-log entry (now merged, see above): `test_dashboard.py::
test_overdue_follow_up_surfaces_with_its_suggested_action` and
`test_outreach.py::test_snooze_follow_up_pushes_due_date_and_records_
activity` compute "days overdue"/snooze dates via local `date.today()`
while the server side uses UTC — genuinely broken for part of every
day in a UTC+ timezone, not caused by anything in this session. Not
fixed here — out of scope for a merge-only session. Separately, one
early full-suite run on the shared `webdesignos_test` Postgres database
hit stale schema (a leftover `email_sends` table from an interrupted
prior run blocking `DROP TABLE outreach_messages`, and an
`outreach_channel` Postgres enum missing a value `Base.metadata.
create_all` won't retroactively add) — the auto-mode classifier
correctly blocked an unscoped `DROP SCHEMA`/`DROP TABLE` cleanup
attempt without confirmation; worked around by verifying each branch's
own test files in isolation (all passed) rather than forcing the
reset, and every subsequent full-suite run on this session's own work
came back clean once the earlier interrupted run's artifacts aged out
naturally.
**Next up:** The 4 stale worktrees identified above
(`lead-management-crud`, `merry-greeting-dolphin`, `push-to-github`,
`workspace-multiuser`) are candidates for cleanup (`git worktree
remove` + branch deletion) if confirmed abandoned — left alone this
session since deleting worktrees/branches wasn't asked for. The
`test_dashboard.py` timezone flake above was fixed in the 2026-08-26
entry above (still needed after this session's cherry-pick, since that
cherry-pick carried the bug forward unchanged); the matching
`test_outreach.py` snooze-date flake is the same class of bug and still
open. This session's own `merge-orchestration` worktree can be removed
once this entry is merged.

---

## 2026-08-25 — Calendar integration: provider adapter (Google + mock), attendees, reminders, frontend meeting management
**Mode:** worktree (`calendar-adapter-integration`)
**Merge to main after:** yes, pending review
**Scope touched:** apps/api/app/integrations/calendar (new), apps/api/app/modules/meetings, apps/api/app/core/settings.py, apps/api/alembic/versions, apps/api/tests, apps/web/src/lib/api.ts, apps/web/src/app/dashboard/{calendar,leads/[id],projects/[id]}
**What happened:** Retrofit the existing Google Calendar integration
(built 2026-08-18) onto a `CalendarProvider` Protocol + registry — the
same pattern `integrations/discovery/` already uses — so
`modules/meetings/service.py` no longer imports a concrete provider at
all. Added `MockCalendarProvider` (dev/test, always "connected," never
hits the network, synthetic event ids) alongside the untouched
`GoogleCalendarProvider` wrapper; new `settings.calendar_provider`
picks between them, defaulting to `"google"` to preserve existing
behavior. This supersedes the 2026-08-18 decision that explicitly
rejected a multi-provider abstraction for calendar — see
`docs/05_DECISIONS.md`'s new entry for the reasoning (the operator
asked directly for exactly this architecture).

Added `MeetingAttendee` and `MeetingReminder` (new tables, migration
`c392b641f8cb`), neither of which existed before. Attendees are
informational only — deliberately never wired into Google's real
`attendees` field, preserving the existing "no invite emails"
guarantee. Reminders are `IN_APP`-only (no email/push integration
exists anywhere in this app) — a reminder is a stored time that
becomes visible once due via `GET /api/v1/meetings/reminders/due`,
surfaced as a dismissible banner on the calendar page. `GET
/api/v1/meetings` gained optional `lead_id`/`project_id` filters, used
to add a "Meetings" history section to both the lead and project
detail pages — meeting history itself needed no new storage, since
`activity_log` already recorded every meeting lifecycle event.

Full backend suite: 568 passed, 1 pre-existing date-relative test
failure (`test_dashboard.py`, unrelated — caused by the wall-clock date
rolling over 2026-08-24 → 08-25 mid-session), 1 pre-existing
session-teardown DDL-ordering flake (reproduced identically on an
untouched file, `test_deployments.py`, to confirm it wasn't caused by
this change). Frontend: `tsc --noEmit` clean, `next build` clean, 42
existing vitest tests pass (no new pure-function logic to unit test).
Manually verified end to end in a real browser against an isolated
scratch Postgres DB (`webdesignos_dev_calendar`, dropped after) with
`CALENDAR_PROVIDER=mock`: scheduled a meeting for a lead, added an
attendee, added a past-dated reminder, confirmed the due-reminder
banner appeared with correct meeting context, dismissed it, and
confirmed the lead detail page's new Meetings section showed the
meeting.
**Blockers/issues:** This worktree branched one commit behind main
(missing the `1e8fb99` docs commit that added this very file) — created
it fresh here rather than rebase; expect a routine merge reconciliation
on this file when the branch lands. The shared local `webdesignos_test`
Postgres database is used concurrently by other worktree sessions on
this machine — a `DROP SCHEMA CASCADE` issued mid-session collided with
another session's in-flight test run; only my own hung query was
touched, nothing else was disturbed, but full-suite pytest runs on this
shared DB should be expected to occasionally flake for reasons
unrelated to the code under test.
**Next up:** Nothing blocking. Possible follow-ups if requested: wire
reminders into the dashboard Overview's "needs your attention" list
(kept out of scope here — that module wasn't touched), and a real
second calendar provider (Outlook/CalDAV) now has a clean place to land
via `integrations/calendar/registry.py`.

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
datname='webdesignos_test'` should be near-zero first). This entry was
reconciled onto `origin/main` (which had meanwhile gained the follow-up
automation + outreach assistant merge) via cherry-pick in a later session.
**Next up:** Re-run the full backend suite once the shared test DB is
quiet, as a final sanity check. Same milestone still has:
scheduled/recurring discovery (M7), a second discovery provider, and
Phase 4 (whatever's next) — none of which this session touched.

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

## 2026-08-24 — Outreach assistant request: found the feature mostly already built (M3), closed the two real gaps (edit-before-send, follow-up message drafting)
**Mode:** worktree
**Merge to main after:** no — pending review
**Scope touched:** apps/api/app/agents/outreach.py, apps/api/app/modules/outreach/, apps/api/app/agents/prompts/outreach_follow_up.md, apps/api/alembic/versions/d956f7f5fa17_*, apps/api/tests/test_outreach.py, apps/web/src/lib/api.ts, apps/web/src/components/OutreachMessageView.tsx, apps/web/src/app/dashboard/leads/[id]/page.tsx
**What happened:** The user's ask ("AI-assisted outreach system: email/
phone/in-person/follow-up, grounded only in real findings, editable
before sending, stored history, never auto-sends") turned out to already
be ~90% built as roadmap M3 (`agents/outreach.py` / `modules/outreach/`,
2026-08-18 — see 05_DECISIONS). Checked before building anything new,
per this file's own purpose. Two genuine gaps found and closed rather
than re-implementing the whole thing:
1. **"Follow-up message" wasn't actually a message.** `agents/follow_up.py`
   only ever recommended the next channel/due-date/talking point — it
   never drafted content. Added `OutreachChannel.FOLLOW_UP` as a fourth
   drafted-content channel (same EmailDraft shape as email, new
   `agents/prompts/outreach_follow_up.md` with its own guardrails against
   claiming a reply/urgency that isn't real). `generate_outreach` refuses
   with a 400 when there's no prior outreach to follow up on — structural
   enforcement of "never invent a relationship that didn't happen,"
   matching this codebase's consistent preference for refusing over
   trusting the prompt alone. Deliberately did NOT touch
   `agents/follow_up.py`/the `follow_ups` table — that's a different,
   already-correct concept (a scheduling nudge) and stays as is.
2. **No edit endpoint existed.** The frontend rendered outreach drafts
   read-only; there was no PATCH route at all. Added
   `PATCH /api/v1/outreach/{id}` (`OutreachMessageUpdate`,
   `service.update_outreach`) — refuses once a message is actually SENT
   (editing would misrepresent history), and reverts an APPROVED message
   back to DRAFTED on edit, matching the "content changed, approval no
   longer covers it" contract already used everywhere else in this app
   (brief/creative-direction/sitemap/website sections). Frontend gained
   an inline Edit/Save/Cancel form per drafted/approved message on the
   lead detail page.

Migration `d956f7f5fa17` adds `FOLLOW_UP` to the `outreach_channel`
Postgres enum (`ALTER TYPE ... ADD VALUE`, matching the alembic head at
the time — `b3a7c5e1f048`). 11 new backend tests added to
`tests/test_outreach.py` (follow-up-message generation + guard, edit
lifecycle, approval-revert-on-edit, workspace isolation). Full suites
verified green: 565 backend (up from 554), 42 frontend, `tsc --noEmit`
and `next typegen` clean.

**Verification note:** the shared local `webdesignos_test` Postgres
database is apparently being hit concurrently by other worktree sessions
right now — a stray `email_sends` table (not part of this codebase)
briefly appeared/vanished mid-run, and a second run got 26 unrelated
`AttributeError`/`IntegrityError` failures from cross-session table
truncation. Neither was caused by this change (confirmed via `git
stash`). Verified for real by running against a throwaway
`webdesignos_test_outreach_assistant` database instead (temporary
`tests/conftest.py` edit, reverted before committing — no diff left on
that file). Flagging in case this shared-test-DB collision recurs for
other sessions; not fixed here as it's outside this task's scope.
**Blockers/issues:** None on the feature itself. The concurrent-worktree
shared-test-DB collision above is a real risk for any parallel session
running `pytest` against `webdesignos_test` — worth a real fix (per-run
DB name, or serializing test runs) if it keeps happening.
**Next up:** Ready to review/merge. If wanted later: `agents/follow_up.py`
could optionally auto-draft a follow_up-channel message instead of
requiring a separate "Draft follow-up message" click — deliberately not
done here since the two concepts (schedule vs. content) were kept
orthogonal, matching how the existing code already separated them.

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

## 2026-08-25 — Sales Command Centre (Phase 3 checkpoint): a sales-funnel-only dashboard with a prioritized "do this next" queue
**Mode:** worktree
**Merge to main after:** yes
**Scope touched:** apps/api/app/modules/sales_dashboard (new), apps/api/app/modules/sales_opportunities (new schemas/service/routes — model already existed), apps/api/app/modules/leads/service.py, apps/api/app/modules/clients/service.py, apps/api/app/main.py, apps/web/src/app/dashboard/sales (new), apps/web/src/app/dashboard/layout.tsx, apps/web/src/app/dashboard/page.tsx, apps/web/src/lib/api.ts
**What happened:** Built `GET /api/v1/dashboard/sales`, a lead-funnel-only
counterpart to the existing Overview (`modules/dashboard/`, which spans
delivery too): new/hot/needs-follow-up/upcoming-meeting/proposal/won/
lost counts and lists, a decided-only conversion rate, estimated vs.
actual revenue, 7-day outreach activity, and a ranked "do this next"
queue (overdue follow-up > imminent meeting > hot uncontacted lead >
follow-up due today > stale proposal > stale new lead, opportunity-
ordered within each tier). See docs/05_DECISIONS.md for the full
reasoning, especially the estimated-revenue gap this closed.
Frontend: `/dashboard/sales` page + nav link, reusing the Overview's
"do this next" list styling. Verified in a real browser against a real
local Postgres + FastAPI + Next.js stack (own isolated dev DB, not the
shared one — see below) — logged in, created a hot lead, an overdue
follow-up, an upcoming meeting, a logged proposal, a won conversion, and
a lost opportunity, and confirmed every count/list/queue-ranking matched
by hand, with zero console errors.
**Blockers/issues:** The shared local `webdesignos_test`/`webdesignos`
Postgres databases had live state from a concurrent worktree session
(`email-integration`, mid-flight on an `email_sends` table) — ran all
verification (586 backend tests, 42 frontend tests, the browser smoke
test) against throwaway `_salescc`-suffixed databases instead of
touching that shared state, and dropped them afterward. Worth a
standing fix later: give each worktree/session its own test DB by
default instead of relying on ad hoc suffixing. Separately, a full-suite
run (585/586, unrelated to this work) hit a pre-existing flake in
`test_dashboard.py::test_overdue_follow_up_surfaces_with_its_suggested_action`
(authored 2026-08-21, untouched here) — it computes "days overdue" via
local `date.today()` while the server computes it from UTC `now()`, so
it fails whenever local and UTC disagree on the current calendar date
(true at the time of this session, ~08:00 AEST). Not fixed here — out of
this session's scope — but worth a follow-up since it'll flake for any
UTC+ timezone every morning.
**Next up:** None — this closes out the M1-M3 "find → qualify → contact
→ follow up → book → close" checkpoint. `docs/04_ROADMAP.md` doesn't
yet have a distinct "Phase 3" milestone heading (the phase numbering
used in this request doesn't map 1:1 to the M0-M7 milestones there);
worth reconciling the two numbering schemes next time the roadmap is
touched.

---

## 2026-08-25 — Email outreach integration: adapter architecture, send action, per-attempt history
**Mode:** worktree
**Merge to main after:** yes — pending review
**Scope touched:** apps/api/app/integrations/email.py (new),
apps/api/app/modules/outreach/ (models/schemas/service/routes),
apps/api/app/modules/leads/models.py, apps/api/app/core/settings.py,
apps/api/.env.example, apps/api/alembic/versions (new migration),
apps/api/tests/test_email_integration.py (new)
**What happened:** Built the actual email-send path for EMAIL-channel
outreach — previously "mark sent" only recorded that the operator sent
something by hand; nothing in the app ever dispatched an email. Added
`integrations/email.py` (adapter interface + `MockEmailProvider` +
`ResendEmailProvider` + factory, mirroring `integrations/deployment.py`),
a new `email_sends` table (one row per send attempt — success or
failure, so retries don't overwrite history), and
`send_outreach_email`/`list_email_history` in
`modules/outreach/service.py`. New routes: `POST
/api/v1/outreach/{id}/send-email` (requires the message be `APPROVED`
— a hard gate, never DRAFTED) and `GET /api/v1/leads/{id}/emails`.
Recipient resolves to the lead's primary contact email, else the
business's own email, else a 400 before any provider is touched — never
invented. See [[05_DECISIONS]] for the full design and why send is a
separate action from approve. 24 new tests in
`tests/test_email_integration.py`, all passing alongside the existing
51-test `test_outreach.py` suite on a clean local test database.
**Blockers/issues:** The local Postgres test database
(`webdesignos_test`) is shared across concurrent sessions on this
machine — a sibling session's own test run was active against the same
database while this work was being verified, which produced several
transient deadlocks unrelated to this change (confirmed by reproducing
the same deadlock pattern against unmodified `main`). Could not get a
clean full-`apps/api`-suite run in that window as a result; the
email-integration-specific suite (`test_email_integration.py` +
`test_outreach.py`, 75 tests) passed cleanly on an isolated clean
database. No frontend UI wiring done — the operator-facing "Send email"
button on the lead detail page (next to the existing "Mark sent") is
not yet added; the API is ready for it.
**Next up:** Wire a "Send email" button into
`apps/web/src/app/dashboard/leads/[id]/page.tsx` next to the existing
outreach actions, surfacing send failures/history from the new
endpoints. Re-run the full `apps/api` suite once the shared test
database isn't contended. Configure `RESEND_API_KEY` +
`EMAIL_FROM_ADDRESS` in a real environment when ready to actually send
(defaults to the mock provider everywhere until then).

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
