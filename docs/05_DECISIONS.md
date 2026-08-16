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

## 2026-08-17 — Explainable lead scoring: config-driven rule engine, append-only history

**Decision:** Built the lead-scoring engine (stage 4, LEAD SCORE) as a
config-driven rule engine, not code-embedded scoring logic:

- **The scoring policy is data, not code** — `app/agents/scoring_rules.json`
  holds the six category weights (summing to 100), the target-industry
  and target-region lists, and every point-scoring rule (a signal name,
  a comparison operator, a point value, and the human-readable reason it
  produces). `app/agents/lead_score.py` is a generic evaluator over that
  data (`_eval_condition`, `_score_category`) plus the *signal
  extraction* step (reading Business/Lead/WebsiteAudit fields into a
  flat named-signal dict) — extraction has to be code, but the actual
  scoring policy doesn't. This directly satisfies "configurable later
  without rewriting the system": retuning a weight, changing which
  industries count as target verticals, or adjusting a rule's point
  value is a JSON edit, no Python change. Mirrors the existing
  "prompts as their own files" precedent in [[02_ARCHITECTURE]] §6.
- **Explainability is structural, not incidental.** Every point on the
  board is a `ScoreReason` (`rule_id`, `description`, `points`) that
  traces back to exactly one config rule — there's no scoring path that
  produces a number without a corresponding reason. `_score_category`
  can't do otherwise; it only ever adds points alongside the reason that
  earned them.
- **No sensitive personal characteristics — enforced structurally, not
  just as a rule.** `LeadScoreInput` (the only data the engine can see)
  has no field for a person's name, age, gender, ethnicity, religion, or
  any other personal characteristic — it's business-level facts only
  (industry, location, registration, contact channels, website
  findings). A test asserts this directly (`test_no_sensitive_personal_
  characteristics_in_input_schema`) so a future field addition that
  drifts from this can't land silently.
- **No fabricated revenue/performance.** `commercial_value` and
  `growth_opportunity` — the two categories closest to "how much is this
  worth" — are scored from legitimate, observable proxies only (ABN
  registration, industry price-point norms, contact-channel count,
  visible marketing signals), never a guessed dollar figure. Both
  categories are structurally capped at MEDIUM confidence regardless of
  how much data is available (`_confidence_for`), and every score run
  carries a standing warning that revenue, profit, and customer volume
  are unknown. Overall confidence is the *weakest* of the six category
  confidences, not an average — a lead can't read as "high confidence"
  overall on the strength of its most measurable categories alone.
- **`confidence` and `warnings` reflect real data gaps.** No website
  audit on file → `website_opportunity` confidence drops to LOW and a
  warning is added, rather than guessing at technical findings. No
  industry/location recorded → the same pattern for `business_fit`/
  `local_relevance`. Target lists left empty in config → scored neutral
  with a warning, not silently skipped.
- **Storage is append-only.** `lead_scores` is a new table, one row per
  scoring run, never updated in place — mirrors `website_audits`'
  history pattern. `trigger_score` always inserts a new row and updates
  `leads.score` (the quick-glance field) to the latest result, but never
  deletes or overwrites a prior `LeadScore` row, so "how did this lead's
  score change after that audit" stays answerable. `based_on_audit_id`
  records which website audit (if any) informed the run, for
  traceability between the two.
- **Runs synchronously**, same reasoning as the audit engine in the
  entry below — pure computation over already-stored data, no network
  calls, no reason to build job-queue plumbing for a sub-second call.

**Why:** The operator's brief explicitly asked for configurability
without a rewrite, full explainability, and a hard ban on fabricating
revenue/demographics — a rule engine over a data file is the
straightforward way to get all three at once: config changes need no
code change, every point traces to a named rule, and the categories
most prone to invented numbers are structurally prevented from claiming
false confidence.

**Alternatives considered:** An LLM-based scorer (prompt the categories
and ask for a score) — rejected; it would make "explainable" much
harder to guarantee (an LLM's stated reasons don't necessarily match
what actually drove its score) and reintroduces exactly the fabrication
risk the brief explicitly warned against for revenue/performance
categories. A Python-native rule table (a list of lambdas/dataclasses in
code) instead of JSON — rejected because it fails the literal
"configurable without rewriting the system" requirement: editing a
lambda is a code change requiring a deploy through the normal review
path, not a data edit.

---

## 2026-08-17 — Website audit engine v1: static HTML analysis, SSRF-safe fetch, no rendering

**Decision:** Built the first version of the website-audit engine
(stage 3, WEBSITE AUDIT, in [[00_VISION]]) as a synchronous, deterministic,
static-HTML-analysis pipeline — no LLM calls, no Playwright/browser
rendering. Concretely:

- **`app/integrations/safe_http.py`** — a new SSRF-safe HTTP client, and
  the *only* sanctioned way anything in this codebase fetches a lead-
  supplied URL. Validates scheme (http/https only), resolves the
  hostname itself and checks every resolved address against private/
  loopback/link-local/multicast/reserved/CGNAT ranges (IPv4 and IPv6),
  then **pins the actual connection to the validated IP** via httpx's
  `sni_hostname` extension rather than letting the HTTP stack re-resolve
  at connect time — this closes the DNS-rebinding gap (validate one IP,
  connect to a different one a moment later) that a naive "resolve, check,
  then let the library connect normally" approach leaves open. Redirects
  are followed manually, up to 3 hops, with the full validate-and-pin
  pipeline repeated at every hop, since redirecting to an internal
  address after an initial safe-looking request is the most common real-
  world SSRF bypass. See docs/06_SECURITY.md.
- **`app/agents/website_audit.py`** — fetches the homepage plus
  `robots.txt`/`sitemap.xml`/linked CSS/a sample of linked resources (all
  through the safe client), parses with BeautifulSoup (new dependency),
  and extracts the operator's full requested field list (technical, SEO,
  performance, mobile, accessibility, conversion, design) using only
  static analysis — no JavaScript execution, no rendering, no screenshot.
  Every data point is either directly measured or explicitly absent;
  nothing is guessed. Each finding is tagged `verified_fact` /
  `inference` / `subjective_observation` (`website_audit_schemas.py`),
  which is what "clearly separate verified facts, inferences, and
  subjective observations" turns into in code — the tag drives both the
  structured JSON and the grouped sections of the generated markdown
  report. Color contrast and full visual/typography/layout assessment
  are explicitly marked as not measured in this version rather than
  faked, since they genuinely require rendering.
- **Runs synchronously** inside the `POST /leads/{id}/audits` request —
  not via the `jobs` table + poller mechanism [[02_ARCHITECTURE]] §4
  already specifies for background agent work. A single-site fetch
  bounded by short timeouts is a few seconds; building the job-queue
  plumbing for that isn't worth it for a "first version." Revisit if
  audits start timing out the request or if bulk/batch auditing gets
  built.
- **Storage:** `website_audits` gained `url`, `status`
  (`success`/`blocked`/`failed`), `results_json` (JSONB — the full
  structured output), `report_markdown`, `error`, `flagged_for_review`;
  the old `notes` column was dropped (superseded by `report_markdown`).
  `has_existing_site`/`mobile_friendly`/`https`/`page_speed_score` stay
  as a denormalized quick-glance summary, populated from the same run.
- **API:** `POST /api/v1/leads/{id}/audits` (audits `business.website_url`
  — 422 if unset) and `GET /api/v1/leads/{id}/audits` (history, newest
  first), both workspace-scoped via the same lead-ownership pattern used
  everywhere else. A minimal "Website audit" section on the lead detail
  page triggers a run and renders the latest report.

**Why:** The operator's brief was explicit and detailed about the
requested fields, the fact/inference/observation separation, "never
fabricate," and SSRF hardening — all of that is achievable from a
static fetch + parse pipeline for the vast majority of the requested
checks (title/meta/headings/canonical/robots/sitemap/alt-text/CTA-
detection/etc. are all present in the raw HTML/CSS). Rendering-dependent
checks (real contrast ratios, JS-rendered content, true responsive
behavior, actual visual/typography quality) are the minority and are
honestly labeled as not measured rather than approximated — matches
[[00_VISION]]'s "never fabricate" instruction and this project's
existing "no placeholder functionality" ethos better than a rendering
pipeline that was rushed and produced unreliable numbers would have.

**Alternatives considered:** Playwright-based rendering (the original
[[02_ARCHITECTURE]] §6 plan for this role) — deferred, not rejected;
it's the natural way to eventually add real contrast/visual/JS-rendered
checks, but building SSRF-safe request pinning against Chromium's own
network stack is materially harder than against httpx/httpcore (no
equivalent to the `sni_hostname` pinning trick), and the static-analysis
version alone already covers most of the requested field list. LLM-
assisted synthesis of the findings into a narrative report — rejected
for v1; a markdown report grouped by category and fact/inference/
observation is already genuinely useful and keeps the whole pipeline
deterministic and cheap, with no API key dependency.

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
