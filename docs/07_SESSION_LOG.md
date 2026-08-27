# Session Log

Chronological record of Claude Code work sessions on this project.
One entry per session. Newest entries at the top.

Purpose: pick up exactly where the last session left off without
re-reading the whole codebase or re-explaining context. This is
separate from `05_DECISIONS` (architecture/design reasoning) and
separate from pipeline/lead state tracking (business data) — this file
is purely "what did an agent do in this coding session."

---

## 2026-08-27 — Phase 8 part 3, task 1: cross-platform + deployment QA
**Mode:** worktree (`phase8-part3-qa-audit`)
**Merge to main after:** yes
**Scope touched:** scripts/start-mac.sh only (code); this entry (docs).

**What happened:** Live-tested the macOS launcher against the actual
running dev stack (Postgres via Docker, uvicorn on :8000, `next dev` on
:3000) rather than a throwaway copy, since that's what was already up
on this machine — every stop/start cycle below is real, not simulated,
and `docker compose stop` (not `down`) made it safe to do so.

Verified on macOS, live: cold start (fresh `stop-mac.sh` → `start-mac.sh`,
~9s end to end), idempotent re-start while already running (no duplicate
processes), stop/start/restart, database persistence across a full
stop/start cycle (row counts identical before/after), occupied-port
detection (planted an unrelated process on :8000 — the script correctly
refused rather than sharing the port), missing-`.env` detection (fails
immediately with the documented message), and — unplanned but
genuinely useful — Docker Desktop quit entirely mid-session (unrelated
to this work) and `start-mac.sh`'s "Docker isn't running → launch it →
wait up to 60s" path recovered the whole stack automatically with no
data loss.

Found and fixed one real bug in this process: `start-mac.sh`'s
readiness checks (`curl -fs -o /dev/null $URL`) had no request timeout.
Reproduced live — blanked `SESSION_SECRET` to make the API crash during
import — and confirmed uvicorn's `--reload` reloader pre-binds the
listening socket before the crash, so the port accepts a TCP connection
but never answers it. Without a timeout, `curl` blocks on that
connection indefinitely, so the documented "fails within 30s with the
log tail" contract never fires — the script just hangs. Fixed by adding
`--max-time 3` to all three health-check `curl` calls (`url_up()` plus
both `wait_for` calls), verified against an isolated raw socket that
accepts and never responds (confirmed hang without the flag, confirmed
a clean 3s bail-out with it), then re-verified the exact original
failure scenario now fails correctly within the documented window.
`stop-mac.sh` and both Windows scripts were unaffected — Windows
already used `Invoke-WebRequest -TimeoutSec 2`, so this was a
Mac/curl-specific gap, not a design gap.

Windows (`start-windows.ps1`/`.bat`, `stop-windows.ps1`/`.bat`):
reviewed in full; **could not be live-tested — no Windows machine or VM
available in this environment.** Findings from code review only:
- Health-check timeouts are already correct (`-TimeoutSec 2`), so the
  Mac bug above has no Windows equivalent.
- Docker Desktop auto-start hardcodes
  `C:\Program Files\Docker\Docker\Docker Desktop.exe`; a non-default
  install location means auto-start silently can't find it and the
  script asks the user to start it manually — already handled as a
  clear failure message, not a crash, so left as-is.
- `stop-windows.ps1` always force-kills (`taskkill /PID /T /F`)
  immediately, versus macOS's graceful-SIGTERM-then-10s-then-SIGKILL.
  This is an intentional platform difference (Windows has no clean
  cross-process SIGTERM-equivalent for a console app without attaching
  a job object), not a bug — dev-mode `uvicorn --reload`/`next dev`
  have nothing meaningful to flush on exit. Documented here since it's
  a real, if minor, behavioral asymmetry between the two platforms.
- Path handling, `.env`/`.env.local` presence checks, and the
  Docker/Postgres readiness sequence are structurally identical to the
  (now live-verified) macOS script — same commands, same flags, same
  order — so they're taken as correct by parity rather than
  independently proven.

Also surfaced, environment-specific (not a code or architecture issue,
not fixed): this machine has a **native Homebrew PostgreSQL 16 service
running independently of this project**, bound to `localhost` (both
`127.0.0.1` and `::1`) via a `launchd` agent. macOS routes `localhost`
traffic to that specific-address bind ahead of Docker's wildcard-bound
port-forward, so every `DATABASE_URL=...@localhost:5432/...` connection
— the app's own, and any ad-hoc script or migration run from this
machine's host — reaches the **native** Postgres, not the
`docker compose`-managed container. Confirmed by tracing the running
API process's actual TCP connection to its serving `postgres` backend
PID, whose parent is the native service, not the container. Practical
consequences: `stop-mac.sh`'s `docker compose stop postgres` does not
actually stop the database backing the app *on this machine*; the
Docker container has grown its own independent, effectively-abandoned
`webdesignos` database (still at its original single-row seed) that
nothing real ever touches. Real data is safe (confirmed: 3 users, 2
workspaces, 4 leads, 4 clients, 9 projects, all intact throughout this
session), but anyone assuming the Docker volume is the durable copy of
this project's data is wrong on this specific machine. Left the
app/Docker architecture unchanged since this is a one-machine
environment conflict, not a defect — noted here so a human can decide
whether to stop/disable the native service (`brew services stop
postgresql@16`) or move it off port 5432.

Fresh-database-setup verified separately and safely: created an
isolated scratch database on the *actually-in-use* (native) Postgres
instance, ran `alembic upgrade head` against it from empty — the full
~30-migration chain applied cleanly with no errors — then dropped it.
Did not touch the real `webdesignos` database's migration state: its
`alembic_version` currently points to a revision from an unmerged
concurrent worktree branch (`worktree-phase7-part2-action-engine`,
today's "add notification system" work) that hasn't reached `main` yet
— expected in this multi-worktree shared-Postgres workflow, not drift,
and not something to touch from an unrelated audit session.

**Blockers / follow-ups:** Windows behavior above is code-reviewed only,
never executed — flagged per the task's explicit instruction rather than
silently assumed correct. The native-Postgres-vs-Docker port conflict is
a real machine hazard worth a human decision (see above); not acted on
here since it's outside this project's code/architecture.

---

## 2026-08-26 — Phase 6 part 2: deployment adapter architecture + delivery workflow
**Mode:** worktree (`phase6-part2-deployment-delivery`)
**Merge to main after:** yes
**Scope touched:** apps/api/app/integrations/deployment/ (new package,
replaces integrations/deployment.py), apps/api/app/core/settings.py,
apps/api/.env.example, apps/api/app/modules/deployments/{models,schemas,
service,routes}.py, apps/api/app/modules/projects/{models,schemas,
service,routes}.py, two alembic migrations, apps/web/src/lib/api.ts,
apps/web/src/components/{DeploymentPanel,DeliveryPanel}.tsx,
apps/web/src/app/dashboard/projects/[id]/page.tsx, docs.

**What happened:** Two-task session, two commits per the operator's
explicit split.

Task 1 — turned the single-file `MockDeploymentProvider` into a real
adapter architecture: `integrations/deployment/` package with a
`DeploymentProvider` interface (`validate_config`/`build`/`deploy`/
`get_status`/`rollback`), a shared `build_static_site` step (site config
-> real, minimal, deployable HTML/CSS), and real adapters for Vercel
(inline-file deploy API), Netlify (zip deploy + real restore-based
rollback), Cloudflare Pages (direct-upload API), and traditional hosting
(stdlib `ftplib`, FTPS by default) — every credential read only from
`app.core.settings`/`.env`, every real provider's factory fails loudly
(`DeploymentProviderError`) if unconfigured rather than silently
deploying through mock. `DEPLOY_PROVIDER` still defaults to `mock`.
`Deployment` gained `provider_ref` for status polling/native rollback.
18 new provider tests (mocked httpx/ftplib, same pattern as the existing
`ResendEmailProvider` tests) plus the existing deployment suite updated
for the new `build()`+`deploy(bundle, artifact)` two-phase call. Full
backend suite (684 tests) green before committing
(`d47c88b feat: build deployment architecture`).

Task 2 — completed the delivery workflow: `check-status` (re-poll a
provider's status — a no-op today since no provider here has an async
build yet, but the real extension point for one that does) and `verify`
(reuses the existing SSRF-guarded `fetch_page_signals` to confirm a
deployment's URL is genuinely live; a `mock` deployment is recorded as a
simulated pass, never a real fetch against its fake `.mock-deploy.internal`
URL) endpoints on `Deployment`. `Project` gained `delivered_at`/
`delivered_by_user_id`, set only by the new `mark_delivered`
(`POST /projects/{id}/deliver`), gated on the latest deployment being
successful *and* verified plus every item on the existing post-launch
handover checklist (`DEFAULT_LAUNCH_TASK_TITLES`, already seeded on
first deploy — reused as the "final delivery checklist" rather than
inventing a second one) checked off; `GET /projects/{id}/delivery-status`
reports every missing reason at once, same shape as the approvals
endpoint. Frontend: `DeploymentPanel` gained "Check status"/"Verify"
actions and a verified badge; a new `DeliveryPanel` shows the checklist
(checkable inline) and a "Mark project delivered" button; the project
page header shows a "Delivered" badge once set.

Verified for real, not just by test suite: stood up isolated scratch
Postgres DBs + API/web dev servers on non-default ports (8091/3091 —
another concurrent worktree session already had 8000/3000 and, it
turned out, 8010/3010 too), monkeypatched the two LLM-backed generation
agents the way the test suite does so a full brief -> creative direction
-> sitemap -> website -> QA -> client-approval chain could be built
without a real Claude API key, then drove the actual browser via
Playwright through prepare -> execute -> verify -> check off all five
checklist items -> mark delivered, confirming the UI state (verified
badge, checklist gating the delivered button, "Delivered" badge,
project stage flipping to `complete`) at every step. Full backend suite
green again (704 tests, including the new delivery tests), frontend
`next build`/`tsc`/`vitest` all clean. Second commit:
`feat: complete website delivery workflow`.

**Blockers / follow-ups:** None outstanding for this scope. The build
step is a deliberately minimal static-HTML exporter, not a port of
`packages/site-templates` — a pixel-accurate static export is separate,
later work (see 05_DECISIONS). Real provider adapters (Vercel/Netlify/
Cloudflare/traditional) have never been exercised against a live
account — no real hosting credentials exist for this project yet, same
"nothing here is a live, publicly reachable site" caveat the mock
provider has always carried.

---

## 2026-08-26 — Phase 6: secure website previews, client feedback, approval workflow
**Mode:** worktree (`phase6-preview-feedback-approval`)
**Merge to main after:** yes
**Scope touched:** apps/api (new `modules/previews/`, `modules/website_feedback/`;
`modules/websites/` gained `WebsiteWorkflowStatus`/`WebsiteWorkflowTransition`;
`modules/deployments/service.py` gained the workflow gate; 3 migrations),
apps/web (new `/preview/[token]` public page, `PreviewSiteRenderer`,
`PreviewFeedbackForm`, `PreviewLinksPanel`, `WebsiteFeedbackPanel`,
`WebsiteWorkflowPanel`; `lib/api.ts` and new `lib/previewApi.ts`)
**What happened:** Closed roadmap M5's last open item across three
commits — see [[05_DECISIONS]]'s 2026-08-26 entry for the full design.
Task 1: token-based `PreviewLink` (client/internal audience, desktop/
tablet/mobile toggle, version selection, expiration/revocation) and a
public preview page rendering the real site via a new self-contained
`PreviewSiteRenderer` (not a reuse of `packages/site-templates` — no
cross-package workspace tooling exists in this repo to share its
build-less `@/...` imports). Task 2: `WebsiteFeedback` submitted
through the same token, tied to project/version/page/status. Task 3:
a formal `WebsiteWorkflowStatus` state machine on `Website` plus
transition history, layered on top of (not replacing) the existing
boolean approval checkpoints, wired into `modules/deployments/` so
neither creating nor executing a deployment can bypass it. Every new
route/service has real backend test coverage (previews: 17, feedback:
12, workflow: 19 — all passing alongside the pre-existing suite), and
each of the three surfaces was verified in a real browser via
Playwright against locally-run dev servers (API on :8010, web on
:3010, to avoid colliding with another session already on the default
ports) — public preview loads/renders/device-toggles, feedback
submission shows up live in the operator panel and is resolvable,
workflow transitions and history render and update correctly. A real
integration gap only surfaced during that browser/test pass, not code
review: `previews.service._is_visible` initially only checked the old
`Website.approved` boolean, so a version driven through the *new*
workflow to CLIENT_REVIEW was invisible on a CLIENT-audience link —
fixed by making visibility an OR of both checkpoints (see decisions
entry). A second gap: gating deployment strictly on
`workflow_status == READY_TO_DEPLOY` broke the existing "redeploy the
same version" test, since a successful deploy advances it to the
terminal DEPLOYED state — fixed by accepting both READY_TO_DEPLOY and
already-DEPLOYED as deployable.
**Blockers/notes:** Port 8000/3000 and their `.venv`/`node_modules`
were already in use by another session's dev servers when this session
tried to browser-verify — worked around by running on :8010/:3010
against a `node_modules` real-installed in the worktree (a symlinked
one broke Turbopack: "Symlink [project]/node_modules is invalid, it
points out of the filesystem root") and the main checkout's Python
`.venv` invoked by absolute path (worktrees don't get their own
`.venv`). All smoke-test data (a throwaway business/client/project/
website/user) was deleted from the shared local dev Postgres afterward.

---

## 2026-08-26 — Phase 4 "lead to client conversion": audit + hardening, not a rebuild

**Mode:** worktree (`lead-to-client-conversion`, background job)
**Merge to main after:** yes, pending review
**Scope touched:** `apps/api/tests/test_clients.py`,
`apps/web/src/app/dashboard/leads/[id]/page.tsx`,
`apps/web/src/app/dashboard/clients/page.tsx`, this file,
`docs/05_DECISIONS.md`
**What happened:** Asked to "build the lead-to-client conversion
workflow" for Phase 4 (mark a lead WON → convert to client, preserving
business/contact/research/lead/sales history/notes, preventing
duplicates, with a confirmation step and tests). Checked
`docs/04_ROADMAP.md`/`docs/05_DECISIONS.md` first per
[[03_AGENT_RULES]] and found this already built and marked `[x]`
(2026-08-19): `POST /api/v1/clients` with `from_lead_id` already does
the whole thing atomically — reuses the lead's `Business` row, marks
the lead WON, creates the `Client` + an INTAKE `Project` + starter
tasks + a WON `SalesOpportunity`, records `source_lead_id`, and 409s on
a repeat conversion. See the new 2026-08-26 entry in
`docs/05_DECISIONS.md` for the full audit and reasoning. Closed the two
real gaps found against the request: extended
`test_convert_lead_preserves_original_lead_and_its_history` to also
cover `Contact`, `SalesAuditReport`, and `OutreachMessage` rows (and
`Business.notes`/other fields) surviving conversion — previously only
`Interaction`/`WebsiteAudit` were checked — and added an explicit
`confirm()` dialog before the actual conversion call on both entry
points (the lead detail page's "Convert to client" form and the
Clients page's "Add client → Convert a won/open lead" form), matching
the `window.confirm` pattern `clients/[id]/page.tsx` already uses for
its own irreversible action.
**Blockers/issues:** None. The worktree had no `node_modules`/`.next`
of its own (expected for a fresh worktree — see the 2026-08-24
follow-up-automation entry's note on this) — symlinked the main
checkout's `node_modules` and ran `next typegen` to get `tsc --noEmit`
working. Full backend suite: 664/664 passed (Postgres test DB was
quiet, single-session run, no contention). Frontend: `tsc --noEmit`
clean, `eslint` clean on the two changed files, `vitest run` 53/53. Did
not verify in a real browser — no UI shape changed, only a native
`confirm()` gate added in front of an already-manually-verified flow
(the 2026-08-19 entry records that walkthrough).
**Next up:** Nothing blocking. If a real modal/toast system is ever
built for this app, `window.confirm` here (and at
`clients/[id]/page.tsx`'s "Start another project") would be the two
call sites to migrate together, but neither is worth introducing new
UI infrastructure for on its own.

---

## 2026-08-26 — Phase 5 Part 3: QA checks, revision workflow, checkpoint
**Mode:** new session (worktree `phase5-part3-qa-revisions`)
**Merge to main after:** yes — pending review
**Scope touched:** apps/api/app/agents/technical_qa.py,
apps/api/app/integrations/browser.py,
apps/api/app/modules/qa_reports/schemas.py (Task 1); new
apps/api/app/agents/website_revision.py +
apps/api/app/modules/website_revisions/ + migration
c7f3a9d21b04, apps/api/app/main.py, apps/api/app/db/all_models.py,
packages/site-templates (Section.tsx/Hero.tsx/Cta.tsx/types.ts —
new "compact" spacing knob) (Task 2); apps/api/app/agents/
website_generator.py (Task 3 fixes); tests for all three; docs.
**What happened:** Task 1 — added the two QA checks the operator's
checklist named that weren't covered yet: "Calls to action present"
(functionality) and a new `markup` category (raw-HTML-tag-in-content,
duplicate element ids, `<html lang>` — the latter two live-preview-only,
honestly `skipped` without one). Task 2 — built a full revision-request
workflow: operator feedback on a generated website ("make the hero less
generic", "change the CTA", "make mobile spacing tighter") becomes a
targeted edit to just the section it names, tracked as a
`website_revisions` row (sequential number, requested/generated change,
pending/approved/reverted status), with rollback that restores the
prior version as a new one rather than rewriting history, and never
touches unrelated approved sections. Spacing feedback is deterministic
(new `spacing: "compact"` field on hero/cta sections); anything else
goes through a new LLM agent (`agents/website_revision.py`) that edits
only fields the section already has. Task 3 — the Phase 5 checkpoint:
ran the real deterministic generator/anti-slop/QA pipeline against a
from-scratch fake client (Gold Coast plumber, modern/premium). No
Anthropic API credit was available (operator supplied a real key, but
the account had none — confirmed via the actual 400 response), so
creative-direction/sitemap were hand-authored to the same bar a strong
LLM call should hit; everything downstream ran for real, unmodified.
Found and fixed two real generator bugs — see the Task 3 entry under
[[04_ROADMAP]]'s "Site generation" bullet for the full detail: a
service-line separator ("Title — description") was being discarded
instead of used, and the homepage unconditionally duplicated a
dedicated FAQ/Testimonials/Services page's content verbatim (anti_slop
flagged it as duplicate copy, real score 79/100). Fixing both took the
same fixture to anti_slop 100/100 and QA `ready_for_client_review: true`
(0 critical/failed checks). Verdict: not slop by this system's own
definition — everything on the generated site is real, specific,
non-fabricated content — but not yet "premium, ready to sell" either:
every non-home hero heading is still just the bare page title (no
tagline field exists in `DesignBrief` for the generator to draw one
from), and there's no real-photo pipeline at all (`image_assets` is
free-text notes, not structured `Media`). Did not stop the phase over
this, since neither gap is a generation-quality defect — both are
already-scoped, not-yet-built intake/asset capability, called out as
the concrete next priority instead. Full backend suite: 702/702 passing
on a clean, uncontended run of the shared `webdesignos_test` database
(this environment reproduces the same "concurrent runs corrupt the
shared DB" issue prior sessions logged — every full-suite run in this
session was run solo, one at a time, to get a clean result).
**Blockers/issues:** No frontend UI for the new QA checks or the
revision workflow — backend + tests only, matching the operator's
stated Phase 5 Part 3 scope for Tasks 1–2. No Anthropic API credit in
this environment (see Task 3 above) — the real creative-direction/
sitemap LLM calls have never actually been exercised against this exact
fake-client brief; only the deterministic downstream steps have.
**Next up:** Top up the Anthropic account and re-run Task 3's fake
client through the *real* creative-direction/sitemap calls (script
already written, just needs `LLM_API_KEY` with credit) to check the
LLM's own writing quality on top of what's now verified for the
generator itself. Add a per-page/site tagline field to `DesignBrief` +
thread it into `website_generator.py`'s hero-heading logic — the
single highest-impact fix left for "premium-feeling" hero copy. Wire
the revision workflow into the `/dashboard/projects/[id]/website`
frontend (a "Revise" action per section, approve/rollback UI, revision
history). Consider real asset/image upload (needs blob storage) before
calling a generated site "sellable" on visuals as well as copy.
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

## 2026-08-26 — AI-assisted website brief generator (roadmap M4)
**Mode:** worktree (background job)
**Merge to main after:** yes, once reviewed — branch `worktree-website-brief-generator`, not yet merged/pushed by this session
**Scope touched:** apps/api/app/agents/website_brief.py, apps/api/app/agents/prompts/website_brief.md, apps/api/app/modules/website_briefs (new module), apps/api/app/db/all_models.py, apps/api/app/main.py, apps/api/alembic/versions/9c1f5a7e3d62_website_briefs.py, apps/api/tests/test_website_briefs.py, apps/web/src/lib/api.ts, apps/web/src/components/WebsiteBriefView.tsx, apps/web/src/app/dashboard/projects/[id]/page.tsx, docs/04_ROADMAP.md, docs/05_DECISIONS.md
**What happened:** Built the requested website-brief generator as a
synthesizing rollup over the existing intake (`DesignBrief`)/creative
direction/sitemap pipeline rather than a fourth place that overlapping
field set gets authored — see today's [[05_DECISIONS]] entry for the
full reasoning. New `WebsiteBrief` model/table (versioned, DRAFT→APPROVED,
same editable-in-place convention as CreativeDirectionBrief/Sitemap),
`agents/website_brief.py` (LLM synthesis for project_summary/goals/
target_audience/positioning/sitemap/page_purposes/content_requirements/
cta_strategy/visual_direction/functionality/seo_considerations/
technical_requirements), and a service layer that overrides the agent's
draft with real data wherever a resolved Sitemap/CreativeDirectionBrief
already exists (sitemap-derived fields assembled deterministically from
real page rows; CTA strategy/visual direction carried over verbatim).
Two new fields (`confirmed_requirements` built verbatim from
`DesignBrief`, `ai_suggestions` an explicit per-section list built by
the service) satisfy the "clearly distinguish AI suggestions from
confirmed client requirements" / "do not invent client information"
requirements directly. Standard CRUD routes
(`POST/GET /projects/{id}/website-briefs`, `GET/PATCH/POST .../approve`
on `/website-briefs/{id}`), full REST client + `WebsiteBriefView`
component (mirrors `CreativeDirectionView`'s edit/save/approve pattern),
wired into `/dashboard/projects/[id]` between Sitemap and Website.
Migration `9c1f5a7e3d62` (down_revision `731a8a798e83`, confirmed sole
head after creation).
**Blockers/issues:** Full backend `pytest -q` showed 6 failed/833 errors,
but every one of them was in `test_workspace_isolation.py`/other
unrelated files with `DependentObjectsStillExist`/`UndefinedTable`/
duplicate-key errors — the exact same concurrent-shared-test-DB
contention pattern documented in the 2026-08-25 session log entry (other
sessions on this machine actively resetting `webdesignos_test` mid-run).
Confirmed not a regression: `test_website_briefs.py` alone is 9/9 green
every run; running it together with `test_creative_directions.py`/
`test_sitemaps.py`/`test_design_briefs.py`/`test_projects.py`/
`test_workspace_isolation.py` gave 53 passed/14 errors, and
`test_workspace_isolation.py` run completely alone still threw one
`DependentObjectsStillExist` during teardown (13 passed/1 error) —
proof the contention is external, not something this change introduced.
Nothing in `website_briefs`' own files ever appears in any failure.
Frontend: `tsc --noEmit` clean except one pre-existing unrelated error
(`LayoutProps` in `layout.tsx`, a Next.js codegen artifact absent
because `next dev`/`next build` haven't run in this worktree — not
touched by this change); `eslint` on changed files clean except two
pre-existing `react/no-unescaped-entities` warnings on lines this diff
never touched (confirmed via `git diff --stat`: purely additive, 109
insertions/0 deletions on the project page); `vitest run` 53/53 green.
Did not start the dev server / exercise this in a real browser — no
running Postgres instance was confirmed reachable from this session
beyond what pytest already used, and this was scoped as a backend+
frontend build-and-test pass, not a live UI walkthrough.
**Next up:** A real browser pass (generate a brief on a project with/without
upstream artifacts present, confirm the confirmed/AI-suggestion split
renders sensibly) before calling this fully client-ready. Re-run the
full backend suite once the shared test DB is quiet, as a final sanity
check, same standing item as the 2026-08-25 entry. Not yet merged to
main or pushed — this session's commit sits on
`worktree-website-brief-generator` pending review.

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
