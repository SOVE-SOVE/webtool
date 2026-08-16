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
