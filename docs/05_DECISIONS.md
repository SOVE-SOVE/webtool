# Decisions

A running log of decisions and the reasoning behind them, so later work
doesn't silently re-litigate settled questions. Newest entries at the
top. Each entry: date, decision, why, alternatives considered (if any).

---

## Format

```
## YYYY-MM-DD — Short decision title

**Decision:** what was decided.

**Why:** the reasoning — constraint, trade-off, or evidence that drove it.

**Alternatives considered:** (optional) what else was on the table and
why it lost.
```

---

## 2026-08-18 — Calendar + Client Management: Meeting moves to project/lead (not sales_opportunity), unified calendar aggregates meetings + task due dates

**Decision:** Built the first post-M3 feature ahead of the rest of M4
(client intake/brief/sitemap/copy), per explicit operator direction —
the operator wanted the day-to-day operational layer (seeing what's
scheduled, having a real client record) before more automation. Three
things:

- **`meetings` is now a real feature, not schema-only scaffolding.**
  It existed since the initial migration with zero routes/service and
  zero rows. Rather than wire it up as originally drawn (belongs to a
  `sales_opportunity`), `Meeting` now belongs to exactly one of a
  `project` or a `lead` — the same dual-parent shape (nullable FKs +
  a `(x IS NOT NULL)::int + (y IS NOT NULL)::int = 1` check constraint)
  already used by `Task`. New `modules/meetings/` gives it full CRUD
  (list/create/get/patch/delete), workspace-scoped via the same
  outer-join-both-parents-and-OR pattern `tasks/service.py` already
  established.
- **New `modules/calendar/`** exposes `GET /api/v1/calendar?start=&end=`,
  a read-only aggregation (no new table) merging meetings (by
  `scheduled_at`) and open tasks (by `due_at`) into one date-sorted feed
  for a given range. It reuses `meetings/service.py` and
  `tasks/service.py`'s own workspace-scoped query + context-string
  helpers rather than re-deriving the project/lead join a third time.
  `/dashboard/calendar` renders this as a month grid; clicking a meeting
  opens an inline edit panel (notes, outcome, mark held, cancel).
- **Client Management got a detail page** (`/dashboard/clients/[id]`),
  the first entity besides leads to get one — editable business fields
  (reusing the existing business PATCH route), plus `billing_email` and
  `contract_signed_at` added to `ClientUpdate` (previously
  assignment-only), linked projects, and the activity-history feed the
  lead detail page already had. `clients.notes` was deliberately *not*
  added — `businesses.notes` already exists and is shown/edited on this
  same page, so a second notes field would just be two places to look.

**Why:** `sales_opportunities` has no CRUD surface anywhere in this app
— it's only ever created implicitly on lead conversion (see the
2026-08-16 lead-management entry) — so a meeting scoped to it would have
had nothing for the UI to attach to without first building opportunity
selection, which nobody asked for. Scoping to lead/project instead reuses
a pattern that already exists, attaches meetings to the two things a
user actually picks from elsewhere in the app (a lead row, a project
row), and covers both halves of the pipeline the "unified calendar"
requirement asked for — sales calls and post-sale client check-ins —
without inventing a second relationship shape. The dashboard's
`meetings` metric query was updated from a `Meeting → SalesOpportunity`
join to the same outer-join-OR pattern as the task-attention query, for
the same reason.

**Alternatives considered:** Keeping `Meeting.sales_opportunity_id` and
building `sales_opportunities` CRUD/UI alongside it — rejected as
scope creep; nothing in the Calendar/Client Management ask needed
opportunity-level detail, and building a whole new entity's UI just to
unblock meeting scheduling would have been backwards. Adding a project
detail page in this same pass (to host meetings/tasks per-project the
way the lead detail page does) — rejected for now; the projects list
page still only supports inline stage/assignment editing, and a project
detail page is real scope that belongs with M4's intake/brief work,
not bundled into this one. Adding `assigned_user_id` to `Meeting` to
match `leads`/`clients`/`projects`/`tasks` — rejected because
[[01_REQUIREMENTS]]'s "Multi-user & workspace" section explicitly scopes
that pattern to those four record types; a meeting's "whose job is this"
answer already comes from its parent lead/project's assignment.

---

## 2026-08-18 — Closed the two phase-review security findings: in-process rate limiter, pre-navigation SSRF check

**Decision:** Both gaps found by the same day's phase review (below) are
now fixed:

- **Rate limiting** — `app/core/rate_limit.py`: a single in-process,
  per-user, sliding-window limiter (`LLM_RATE_LIMIT_PER_MINUTE`, default
  10/60s), applied via `enforce_generation_rate_limit` as a drop-in
  replacement for `Depends(get_current_user)` on exactly the three
  routes that trigger a paid call — `POST .../sales-audits`, `POST
  .../outreach`, `POST .../follow-ups`. One shared bucket across all
  three per user, not one bucket each, since the thing being protected
  is a single combined API budget either way. Read/list/lifecycle
  endpoints (approve, mark-sent, etc.) are untouched — they don't call
  a paid API, so limiting them would just be user-hostile.
- **SSRF hardening** — `integrations/browser.py`'s new
  `_check_url_is_public()` runs before every `fetch_page_signals()`
  navigation: rejects non-`http(s)` schemes, `localhost`, and any
  hostname that resolves (via `socket.getaddrinfo`, so an IP-literal
  bypass doesn't work either) to a private/loopback/link-local/
  reserved/multicast address — including the `169.254.169.254` cloud
  metadata address. A rejection surfaces as the existing `PageSignals
  .error` path, so it flows through to `audit_error` +
  `flagged_for_review` exactly like a real network failure already did
  — no changes needed anywhere else.

**Why:** These were flagged, not fixed, in the same-day phase-completion
review specifically because each deserved its own scoped design
decision rather than a rushed patch inside an audit commit. The operator
then asked for them to be closed before moving on, so here they are.

**Alternatives considered:** A Redis-backed or database-backed rate
limiter — rejected as over-engineering for a single-process deployment
with no existing cache/queue infrastructure (see
`app/core/rate_limit.py`'s own docstring); revisit only if this ever
runs multiple worker processes behind a load balancer, at which point an
in-process counter stops being meaningful anyway. Limiting per-workspace
instead of per-user — rejected because it would let one runaway teammate
silently exhaust a whole team's shared budget while the rest of the team
gets blocked by someone else's usage; per-user keeps the failure
contained to whoever's actually generating. Full request-level
interception to also block SSRF-via-redirect — rejected as
disproportionate for this pass; the pre-navigation check closes the
direct/obvious vector (an operator or attacker entering an internal URL
outright), and the redirect gap is now explicitly documented rather than
silently unhandled — worth a follow-up if this ever fetches lower-trust
URLs.

---

## 2026-08-18 — M0-M3 phase-completion review: full audit, two security findings deferred to next phase

**Decision:** Before starting M4, ran a full review of the "Lead +
Sales" phase (M0-M3): full backend (113 tests) and frontend (10 tests)
suites, both apps' production builds, a full migration chain round-trip
against an empty database (upgrade base→head and back down clean), a
module-by-module audit of workspace isolation (every list/get/mutate
query traced back to a `businesses.workspace_id` join or an
admin-role gate — no IDOR patterns found; `db.get()`-by-raw-PK is used
in exactly two places, both scoped to the caller's own
`current_user.workspace_id`, never a request-supplied id), and a
security pass against [[06_SECURITY]]'s own checklist.

Found and fixed nothing code-level (everything checked out) except two
real gaps [[06_SECURITY]] already called for but never implemented:
no cost/rate limiting on the paid LLM/search generation endpoints, and
no SSRF hardening on `integrations/browser.py`'s website-audit fetch
(no scheme/private-IP allowlist before navigating headless Chromium to
an operator-supplied URL). Both are documented as open findings in
[[06_SECURITY]] rather than fixed in this pass — deliberately deferred,
not missed.

Also confirmed, not fixed: M1's "activity log per prospect/project" item
is still genuinely partial (projects have no equivalent to the lead
detail page's activity feed) — pre-existing, unrelated to this phase's
work, tracked in [[04_ROADMAP]].

**Why:** The operator asked to close out this phase with a real audit,
not just a feature-complete checklist — a review is only worth doing if
findings get written down somewhere durable enough to act on later,
which is what [[06_SECURITY]]'s new "Open findings" section is for.

**Alternatives considered:** Fixing the two security gaps immediately
as part of this review — rejected for this pass specifically because
the ask was "review + document," and rate-limiting/SSRF-hardening are
each a real design decision (what limit, what allowlist shape) worth
their own scoped change rather than a rushed addition inside an audit
commit.

---

## 2026-08-18 — Sales outreach + follow-up: drafting-only lifecycle, FOLLOW_UP_DUE tied to the generate-follow-up action, LLM reasons in relative days not absolute dates

**Decision:** New `modules/outreach/` backs two features:

- **Outreach drafting** (`agents/outreach.py`) — for a qualified lead,
  drafts an EMAIL (subject + body) or PHONE/IN_PERSON talking points
  (opening line, key points, objection handling, suggested close) via
  three separate prompt files (`agents/prompts/outreach_*.md`), grounded
  in the business record, the latest website/sales audit, and — if this
  isn't the first contact — every prior `OutreachMessage` already
  generated for the lead. `OutreachMessage.status` is
  `DRAFTED → APPROVED → SENT → REPLIED/FOLLOW_UP_DUE → CLOSED`; only
  explicit operator actions (`/approve`, `/mark-sent`, `/mark-replied`,
  `/close`) advance it — nothing in this feature ever sends anything.
  `FOLLOW_UP_DUE` specifically is set when a follow-up is generated
  against a `SENT`/`REPLIED` message, not on a timer — there is no
  background scheduler in this app, so "due" has to be an event, not a
  clock. Marking a message sent/replied also writes an `Interaction`
  row (`interactions` table, previously scaffolded but never written
  to) — this is what now populates the dashboard's "contacted leads"
  metric, which had no other writer before.
- **Follow-up suggestion** (`agents/follow_up.py`) — given a lead's full
  outreach history (or none, for a stalled lead that was never
  followed up on), suggests the next channel, a due date, and what to
  cover. The model reasons in **relative days (1-30), not an absolute
  date** — `run()` converts to a date and clamps server-side. An
  absolute date from the model would require trusting it to know
  today's date correctly and never hallucinate a malformed or
  wildly-off value; a bounded relative offset can be clamped instead of
  rejected outright, which fits docs/03_AGENT_RULES.md's "flag, don't
  fail" posture better than a validation error on the request. Buckets
  (OVERDUE/DUE TODAY/UPCOMING) on `/dashboard/follow-ups` are computed
  from `due_date` vs. today at read time, never stored.

**Why:** Requirement/roadmap M3 explicitly separates "draft" from
"send" — see docs/03_AGENT_RULES.md's outreach/follow-up rule — and asks
for the four states plus overdue/due-today/upcoming bucketing by name.
Every lifecycle and follow-up action records an `activity_log` entry
with the responsible user (`outreach_drafted/approved/sent/replied/
closed`, `follow_up_generated/completed`), per the traceability
requirement.

**Alternatives considered:** One shared prompt file with a
channel parameter instead of three separate `outreach_*.md` files —
rejected so each channel's guardrails and structure (a written email vs.
a call/visit talking-points sheet) can be tuned independently without
conditionals inside one prompt. Letting the LLM pick an absolute
`due_date` directly — rejected per above; the relative-days + clamp
approach was chosen specifically to make a bad value degrade gracefully
instead of crashing the request. Auto-flipping `OutreachMessage.status`
to `FOLLOW_UP_DUE` on a timer — rejected, no background job runner
exists in this app, and tying it to the generate-follow-up action
instead keeps it something the operator explicitly triggered.

---

## 2026-08-18 — Lead score: deterministic, computed from the website audit, not the LLM

**Decision:** `leads.score` (previously a manual-only field) is now
auto-computed by a new `agents/lead_score.py` every time a Sales Audit
is generated, and overwrites whatever was there before — see
`app.modules.sales_audits.service.generate_sales_audit`. The score is a
plain rule-based 0-100 value derived from the website audit's real,
measured signals (no site → 85; site present but unreachable → 90;
otherwise a 30-point baseline plus points for missing HTTPS, not being
mobile-friendly, slow load time, and missing title/meta description,
capped at 80). No LLM call is involved. This closes roadmap M2's third
item ("lead score computed from research + audit") and requirement #4 in
[[01_REQUIREMENTS]].

Fixing this also required a correctness fix in `agents/sales_audit.py`:
its "thin evidence" flag used to treat `lead_score is not None` as a
signal that *some* independent evidence existed. Now that the score is
always derived from the same website audit being judged, that check was
circular and would have stopped firing entirely. `thin_evidence` now
looks only at `website_unusable and not search_results`.

**Why:** Requirement #4 explicitly asks to "avoid wasting time on leads
that don't fit the $599–$1,299 offer" — a manually-entered score can't
do that consistently across dozens of prospects. A deterministic
formula was chosen over folding a score into the sales-audit LLM's
output because: it mirrors `agents/website_audit.py`'s own approach (no
LLM call, same measured signals, same reasoning the operator can already
see in a Sales Audit's sources note); it's free to compute (no added API
cost, matters while credits are being managed); it's fully unit-testable
and never drifts between two runs against identical audit data, unlike
an LLM judgment call would.

**Alternatives considered:** Scoring via the sales-audit LLM call itself
— rejected as strictly worse here: more expensive per run, non-
deterministic (same inputs could score differently across runs, which
would look like a bug to the operator), and it would only run when a
full Sales Audit is generated rather than being available the moment a
website audit exists. Not overwriting an existing manual score — 
rejected because the whole point is for the operator to stop hand-
scoring; a stale manual value silently blocking the computed one would
undermine that. Manual override remains possible via `PATCH
/api/v1/leads/{id}`, it's just re-computed on the next audit.

---

## 2026-08-16 — Lead management: LeadStatus replaces LeadStage; priority, notes, archive; business contact fields

**Decision:** Redirected mid-M2-planning to build out the lead-management
foundation properly first, per explicit operator instruction — CRUD +
workspace authorization + a fast-triage UI, no AI/scraping work yet
(that stays scoped to a future M2 pass). Concretely:

- **`leads.stage` (`LeadStage`, pipeline-shaped: PROSPECT → WEBSITE_AUDIT
  → ... → MEETING → WON/LOST) is replaced by `leads.status`
  (`LeadStatus`: NEW, RESEARCHED, QUALIFIED, CONTACTED, REPLIED,
  MEETING, PROPOSAL, WON, LOST, NURTURE)** — a CRM-style status distinct
  from the delivery-side `ProjectStage` pipeline, which is untouched.
  This supersedes `LeadStage` as described in [[02_ARCHITECTURE]] §3 and
  the lead-side framing in [[00_VISION]]'s pipeline — the 20-stage
  pipeline itself, and `ProjectStage`, are unaffected; only how a
  *lead's own* status is tracked changed.
- Added `leads.priority` (`LeadPriority`: LOW/MEDIUM/HIGH, default
  MEDIUM — always meaningful for sorting), `leads.notes` (free text,
  distinct from the activity-history feed), `leads.archived_at`
  (nullable timestamp — archiving is orthogonal to status; a WON or
  LOST lead can still be archived to declutter the list).
- Added `businesses.email`, `businesses.social_links` (newline-
  separated URLs, plain column, no JSON), `businesses.notes` — the
  entity had no way to record these before. Added the business's
  missing `PATCH /api/v1/businesses/{id}` route (previously
  create+list+get only).
- Added `GET /api/v1/activity`'s optional `entity_type`/`entity_id`
  query params, so a lead's detail page can pull just its own history
  from the existing generic feed instead of a duplicate route.
- **Search/filter/sort implemented client-side**, over the already-
  fetched `GET /api/v1/leads` list, not new server query params — this
  shop's realistic lead volume doesn't need server-side pagination yet,
  and building it now would be exactly the kind of premature infra
  [[00_VISION]] warns against. `list_leads` excludes archived leads by
  default; `include_archived=true` opts in.
- **Dashboard metrics now exclude archived leads** (`total_leads`,
  `qualified_leads`, the stale-lead "needs attention" list) — archiving
  is the operator saying "stop tracking this as active," so it
  shouldn't inflate totals or nag for attention. `qualified_leads`'
  definition moved from "stage is LEAD_SCORE or later" to "status is
  QUALIFIED, CONTACTED, REPLIED, MEETING, PROPOSAL, or WON" — see the
  metric-definitions entry below, not rewritten, just superseded for
  this one metric.
- New `/dashboard/leads/[id]` detail page — editable business + lead
  fields, archive/unarchive, and an activity-history feed. Didn't exist
  before; the list page's inline dropdown edits are kept as-is for fast
  triage.

**Why:** The operator wants the lead-tracking foundation solid — richer
status/priority/notes/archive model, full contact info on a business,
and a UI built for triaging many prospects quickly — before any
AI/scraping automation gets layered on top of it. Building the
automation (M2's research/audit/score agents) against a thin lead model
would mean redoing the schema once the richer requirements surfaced
anyway.

**Alternatives considered:** Keeping `stage` and adding a second
parallel `status` field — rejected as confusing (two "what state is
this lead in" columns) for no benefit; the pipeline-shaped stages
(WEBSITE_AUDIT, LEAD_SCORE, SALES_PREPARATION, etc.) aren't meaningful
CRM statuses on their own and can be reintroduced later as *automation
progress* tracking (e.g. "research done: yes/no" flags) separately from
`status` if M2 needs it, rather than conflating the two. Folding
`archived` into the status enum as an eleventh value — rejected because
archiving needs to compose with every other status (an archived WON
lead is still a won lead), not replace it.

---

## 2026-08-16 — Multi-user: workspace + users + roles, revising the single-operator assumption

**Decision:** The business is now run by two people, not one, so
single-operator auth (one email/password pair in `.env`, no user table)
is replaced with: a `workspaces` table as the tenant boundary, a
`users` table (each user belongs to exactly one workspace, has an
`admin`/`member` role and a real password hash), `businesses.
workspace_id` as the single scoping point for the whole business-domain
tree (leads/clients/projects/tasks/websites all reach their workspace
by following existing FKs up to `businesses`, not by duplicating
`workspace_id` everywhere), and a nullable `assigned_user_id` on
`leads`, `clients`, `projects`, and `tasks` — the four record types
[[01_REQUIREMENTS]] identifies as carrying responsibility. A new
`activity_log` table records which user did what, across entity types
— see [[02_ARCHITECTURE]] §3 for why this one *is* a polymorphic table
when the original activity-log decision (below) rejected that shape for
stage history. Session cookies now carry a user id instead of a fixed
email; every non-public route resolves the current user and filters
queries to their workspace.

Only two roles, matching [[01_REQUIREMENTS]]: `ADMIN` (users, workspace
settings, integrations, plus everything a member can do) and `MEMBER`
(everything else — view all workspace data, work leads/projects/
tasks). No per-record ACLs, no "assigned user can edit but others can
only view" restriction — assignment is about *whose job it is*, not
about gating access; every workspace member can already see and edit
all workspace data per the requirements doc. This keeps the
authorization surface to two checks: "is this row in my workspace" and
"am I an admin," not a permission matrix.

**Why:** The operator explicitly asked for this — two people now work
the same pipeline and need to know who's responsible for what and what
the other person has done, without a side channel. Scoping via
`businesses.workspace_id` alone (rather than a `workspace_id` column on
every table) was chosen because every business-domain table already has
an unbroken FK chain up to `businesses` — adding the column everywhere
would be redundant data that could drift from the FK chain, for no
query benefit `apps/api`'s modest volume needs. Explicitly not built:
invitations/email signup (an admin creates accounts directly — no
`RESEND_*` integration needed for this), per-record permission
overrides, or multi-workspace accounts — none of that is required at
two-to-a-handful-of-users scale, and building it now would be exactly
the kind of enterprise-permissions overengineering [[01_REQUIREMENTS]]
and the earlier overengineering-guardrails decision (below) warn
against.

**Alternatives considered:** A `workspace_id` column denormalized onto
every business-domain table (leads, clients, projects, tasks, contacts,
etc.) — rejected for the redundancy reason above; revisit only if a
specific query pattern genuinely needs to filter by workspace without
joining through `businesses` (none does yet). Row-level security
(Postgres RLS) instead of application-level workspace filtering —
rejected as unnecessary operational complexity for two users; the ORM-
level filter is simple to audit and test at this scale, and every query
already goes through `apps/api`, nothing else touches the database.

---

## 2026-08-16 — First dashboard: metric definitions and a scope fix found while building it

**Decision:** Built CRUD for leads/clients/projects/tasks (table views,
not kanban — see [[04_ROADMAP]] M1) and an Overview page with the 8
requested metrics plus a "Needs your attention" list. Metric
definitions, since several needed a judgment call the schema doesn't
spell out:

- **Qualified leads** — stage is `lead_score` or later (past the audit/
  scoring gate).
- **Contacted leads** — at least one logged `OUTREACH_SENT` interaction
  (the actual event, not just current stage).
- **Won projects** — count of `sales_opportunities` with status WON.
- **Active projects** — projects not yet at `maintenance`.
- **Revenue** — sum of `proposed_price_cents` on WON opportunities.
  Labeled "Revenue (won)" — it's booked/won value, not cash collected;
  there's still no invoicing/payments table.
- **Needs your attention** — incomplete tasks that are overdue, due
  within 2 days, or have no due date at all (undated tasks still need
  triaging); plus leads stuck 5+ days that aren't already won/lost.

**A real gap, found by testing the built UI, not just the tests**:
`won_projects` and `revenue_cents` both read from `sales_opportunities`,
but no route created rows there — the Leads/Clients/Projects/Tasks
pages had no path that would ever populate it. Those two metrics would
have stayed at 0 forever regardless of how the dashboard was used, a
"technically correct, actually dead" gap that only surfaced by clicking
through the real UI end to end. Fixed by having lead→client conversion
(the actual "deal closed" action this UI has) record a won
`SalesOpportunity`, with an optional price captured on that same form.
Backend tests now assert on this directly (`test_convert_lead_records_
won_opportunity_for_dashboard`), not just on the aggregation query in
isolation.

**Why:** A metric that's correct in isolation but unreachable through
the actual product isn't done — see [[00_VISION]] "AI slop is
unacceptable" and this project's general "no placeholder functionality"
rule, which applies just as much to a dashboard number that can never
move as it does to fake AI output.

**Also found and fixed while testing in a real browser**: any FastAPI
422 validation error rendered as the literal string `"[object Object]"`
in the UI — `detail` is a string for `HTTPException` but a list of
`{msg, loc, type}` objects for Pydantic validation errors, and
`apps/web/src/lib/api.ts` only handled the string case. Fixed with an
`errorMessage()` helper that flattens either shape; regression-tested
in `api.test.ts`. This is exactly the kind of bug that only a real
browser walkthrough (not curl, not unit tests in isolation) surfaces —
worth remembering as a reason to keep doing that before calling
frontend work done.

## 2026-08-16 — Foundation hardening: logging, error handling, testing

**Decision:** Closed out the remaining foundations work (what the
operator calls "Milestone 1"): stdlib logging in `apps/api` (no
framework — `logging.basicConfig` plus a module logger, used for login
attempts and unhandled exceptions); a catch-all FastAPI exception
handler that logs the real traceback server-side and returns a generic
`{"detail": "Internal server error"}` to the client; Next.js
`error.tsx`/`global-error.tsx` boundaries; and a real test suite for
both apps.

Backend tests (pytest) run against an actual Postgres database
(`webdesignos_test`, created via a docker-compose init script), not
SQLite or mocks — the models use Postgres-native UUID/Enum types, so a
lighter substitute would test something other than what actually runs.
Frontend tests (Vitest, Node environment, no jsdom) cover `lib/api.ts`'s
error-handling logic, the only real (non-framework) logic in
`apps/web` at this point.

**Why:** These were the parts of "foundation" that were true
infrastructure gaps, not premature — every real app needs to not leak
tracebacks to clients and needs some way to know it's broken without
watching a terminal. Using the real Postgres for tests instead of
SQLite avoids the specific, common failure mode where a lighter test
database passes while the real one would reject the same migration or
query. Using Vitest with a plain Node environment (no jsdom, no
React Testing Library) avoids paying for a browser-simulation
dependency when there's no component logic worth testing yet — that
gets added in M1+ once the kanban board exists.

**Alternatives considered:** `structlog`/`loguru` for backend logging
— rejected, stdlib `logging` is enough at one-operator log volume and
this avoids a dependency with no capability gain yet. `testcontainers`
for spinning up an ephemeral test Postgres — rejected in favor of a
docker-compose init script; the operator already runs `docker compose
up -d postgres` for local dev, so reusing that container for a second
database is simpler than a second container-management layer.

## 2026-08-16 — Shared types: keep hand-written, defer codegen

**Decision:** `apps/web/src/lib/api.ts` keeps hand-written TypeScript
types mirroring the two Pydantic schemas that exist so far (`Me`,
`Business`), instead of adding an OpenAPI-to-TypeScript codegen step
now.

**Why:** [[02_ARCHITECTURE]] §4 already calls for generating types from
the API's OpenAPI schema once the surface grows — that's still the
plan, not reversed. But the entire API surface today is one auth
module and one CRUD module. Adding a codegen dependency and pipeline
(`openapi-typescript`, an export-schema script, a generate command, a
question of whether the generated file is committed or built) to keep
two types in sync is exactly the kind of premature infrastructure
[[00_VISION]] and [[02_ARCHITECTURE]]'s "what this is deliberately
not" section warn against. Revisit as soon as the API surface grows
past what's comfortable to hand-mirror — likely early in M1, once
leads/projects get real routes.

## 2026-08-16 — M0 implemented; two implementation-time decisions

**Decision:** M0 is built and verified locally (server running, DB
migrated, full login → dashboard → logout flow checked in a real
browser via Playwright). Two choices made while implementing that
weren't in the original architecture doc:

1. **Python 3.12, not 3.14, for `apps/api`.** The machine's default
   Python was 3.14 — too new for `pydantic-core`'s and `psycopg`'s
   compiled wheels (PyO3 doesn't support 3.14 yet as of this writing),
   so installing dependencies failed. Homebrew's `python3.12` works
   cleanly. `apps/api/README`/setup docs specify 3.12 explicitly.
2. **`bcrypt` directly, not `passlib[bcrypt]`.** `passlib` 1.7.4's
   bcrypt-backend version-detection code breaks against current
   `bcrypt` (≥4.1 removed the attribute passlib reads), a known
   upstream incompatibility. Calling `bcrypt.hashpw`/`checkpw` directly
   avoids it and drops a dependency — `passlib` was only ever a thin
   wrapper here.

**Why:** Both are "use the version that actually works" calls, not
architecture changes — recorded so a future dependency bump doesn't
silently reintroduce either problem without knowing why the original
choice was made.

## 2026-08-16 — Stack revised: Next.js frontend + FastAPI backend

**Decision:** Supersedes the same-day "Next.js modular monolith"
entry below. The operator wants a clean language split: `apps/web` is
Next.js/TypeScript (dashboard + client-approval pages only, no direct
DB access), `apps/api` is Python/FastAPI (all business logic, all
Postgres access, all AI/agent code, all third-party integrations). Full
design in [[02_ARCHITECTURE]].

**Why:** Two runtime processes are unavoidable once frontend and
backend are different languages — you can't share a process across
TypeScript and Python. This is still "a modular monolith" in the sense
that matters for a solo maintainer: `apps/api` is **one** FastAPI
service organized into modules by domain, not split into per-domain
microservices, and there is **one** Postgres database. The monolith
boundary moved from "one process" to "one backend service, one
database" — the thing it protects against (needing to reason about
inter-service auth, network calls, and independent deploys between
domains) is unchanged. Python was also the better fit for the AI/agent
and browser-automation (Playwright) work this system leans on.

**Alternatives considered:** A single Next.js app doing everything
(the prior decision) — rejected because the operator explicitly wants
Python/FastAPI for the backend, most likely for its AI/data tooling.
A full microservice split per pipeline domain was not seriously
considered — no volume or team-size reason for it at one-operator
scale.

## 2026-08-16 — Original: Tech stack: Next.js modular monolith + Postgres

*(Superseded same-day by the entry above — kept for the record rather
than deleted, per this doc's own rule of not editing history.)*

## 2026-08-16 — Database, API, and AI design details

**Decision:** A set of concrete design choices for [[02_ARCHITECTURE]]:
UUID primary keys throughout (client-approval links are externally
exposed and must not be guessable); no generic polymorphic
`activity_log` table — explicit per-domain tables (`interactions`,
`pipeline_events`) instead; background/agent work runs on a `jobs`
table + in-process poller, not Celery/Redis; the frontend/backend
contract is REST plus OpenAPI-generated TypeScript types, not GraphQL
or tRPC; every AI agent shares one interface (typed input → typed
`AgentResult` with a `flagged_for_review` escape hatch) and calls the
LLM through a single adapter, with prompts as versioned files rather
than inline strings.

**Why:** Each of these is the simpler option that still holds up at
real (if modest) scale, and each avoids a specific known failure mode:
polymorphic tables fight the ORM and the database; a message broker is
unjustified operational overhead for one operator's traffic; a second
type-generation layer (GraphQL/tRPC) adds tooling without adding
capability here; and a shared agent interface keeps the quality-bar
and traceability rules in [[03_AGENT_RULES]] enforceable in one place
instead of per-agent.

**Alternatives considered:** Celery + Redis for jobs — rejected until
job volume or the need for multi-process workers actually appears.
GraphQL — rejected, no client needs partial/nested query flexibility
badly enough to justify it for a two-consumer system (dashboard +
possibly scripts).

## 2026-08-16 — Only 3 of 10 AI roles in near-term scope

**Decision:** Of the ten potential AI roles (research, website
auditing, lead scoring, sales assistant, meeting preparation, creative
director, copywriter, website builder, technical QA, creative QA),
only research, website auditing, and lead scoring are being built now,
per [[04_ROADMAP]] M2. The rest are designed for (a common agent
interface exists) but not implemented. "Creative QA" specifically is
marked advisory-only even when eventually built — final creative
judgment stays human per [[00_VISION]].

**Why:** The operator explicitly asked not to implement all ten. Each
unbuilt role is real, scoped, ongoing prompt-engineering and review
work — building the interface without the implementation avoids
churn later while not pretending judgment-heavy roles are solved
problems today.

**Decision:** One Next.js (TypeScript) app in `apps/os` as the whole
operator tool, Postgres (Neon/Supabase) as the single database,
Drizzle/Prisma as the ORM, Vercel hosting, single-user auth. Generated
client sites are the one deliberate exception — separately deployed
from templates in `packages/`. Integrations: Claude API (agents),
Playwright (audits), Brave Search (research), Resend (email), Stripe
(payments, hosted checkout only), Sentry (errors). Full rationale in
[[02_ARCHITECTURE]].

**Why:** Every "to be decided" item in the architecture draft was
blocking real planning. A solo student maintaining this needs one
codebase and one deploy target, not a distributed system. Managed
Postgres removes all database ops. Stripe-hosted checkout keeps PCI
scope at zero. No microservices, no job queue, no multi-agent framework
— see the overengineering entry below.

**Alternatives considered:** Supabase-as-backend (Postgres + auth +
storage in one) was considered instead of Next.js + separate Postgres
— rejected only to keep the decision simple for now; revisit if
Supabase's bundled auth/storage would remove real integration work.
Split frontend/backend services was rejected outright as unnecessary
complexity for one user.

## 2026-08-16 — Pipeline expanded from 8 to 20 stages

**Decision:** [[00_VISION]]'s pipeline is now PROSPECT → RESEARCH →
WEBSITE AUDIT → LEAD SCORE → SALES PREPARATION → OUTREACH → FOLLOW-UP →
MEETING → CLIENT INTAKE → PROJECT → RESEARCH → DESIGN BRIEF → SITEMAP →
COPY → WEBSITE → QA → MY APPROVAL → CLIENT APPROVAL → DEPLOYMENT →
MAINTENANCE, replacing the earlier 8-stage summary (find → identify →
contact → close → build → approve → deploy → get paid).

**Why:** The 8-stage version was a fine summary but too coarse to
design requirements, agent autonomy, or milestones against — e.g. it
had no distinct audit/scoring step, no split between the operator's own
approval and the client's, and only one undifferentiated "build" stage
covering brief/sitemap/copy/site/QA. The 20-stage version is the same
underlying idea (sales funnel → delivery funnel → paid, live,
maintained), just granular enough to build against directly.

**Alternatives considered:** Keeping both versions (8 as "macro", 20 as
"detailed") — rejected as redundant; the 20-stage version already reads
clearly in two halves (sales: prospect→meeting, delivery: intake→
maintenance), so a second summary adds nothing.

## 2026-08-16 — Security gets its own doc

**Decision:** Added [[06_SECURITY]] as a standing checklist: auth on
the app, secrets management, unguessable client-approval tokens,
treating scraped content as data not instructions, escaping
client-submitted content on generated sites, managed-DB backups,
API cost/rate limits, and scraping etiquette. No custom card handling —
Stripe-hosted checkout only.

**Why:** This tool holds real client PII and touches payments despite
being single-user — "it's just for me" doesn't remove those risks, it
just means there's no second person to catch a mistake. Cheap to get
right early, expensive to retrofit once client data is in the database.

## 2026-08-16 — Overengineering guardrails adopted

**Decision:** Explicitly ruled out for now: microservices, a message
queue/job broker (Redis/BullMQ), a custom multi-agent orchestration
framework, a generic no-code page builder, a custom CMS, and
multi-tenant auth/roles. Background jobs use Vercel Cron + plain API
routes; agents are typed functions invoked directly, not an
autonomous/self-orchestrating system.

**Why:** None of these are load-bearing at one-operator, low-volume
scale, and each adds real ongoing maintenance burden that competes
directly with the revenue/human-hours goal in [[00_VISION]]. Add any of
them later only when a specific, real bottleneck proves the simple
version insufficient — not in anticipation of scale that may never
come.

## 2026-08-16 — Optimize for revenue / human hours, not feature count

**Decision:** Every feature is evaluated against a single filter: does it
save time, make money, reduce mistakes, or improve quality? If not, it's
not a priority.

**Why:** This is a one-operator system meant to fund web design work
during university, not a startup. Headcount and generality aren't goals;
leverage on one person's time is. See [[00_VISION]].

## 2026-08-16 — Pipeline is the spine of the system

**Decision:** The system is organized around the pipeline: find business
→ identify opportunity → contact business → close business → build
website → get approval → deploy → get paid. Every doc and every
component should map to a stage in this pipeline.

**Why:** Keeps scope tied to what actually produces revenue, and makes it
obvious when a proposed feature doesn't belong. See [[00_VISION]] and
[[04_ROADMAP]].

## 2026-08-16 — Output quality is a hard constraint

**Decision:** The competitive strategy is efficiency and accessibility on
price (~$599–$1,299, $899 core offer), not lowering the bar on the
finished product. AI-generated-looking output ("AI slop") is
unacceptable regardless of how much time it saves.

**Why:** Underpricing only works as a strategy if quality holds — if the
output looks cheap, the price becomes a signal of low value instead of
efficiency. This constrains [[01_REQUIREMENTS]] and any agent autonomy
granted in [[03_AGENT_RULES]]: speed cannot come at the cost of a design
a client (or the operator) would be embarrassed by.
