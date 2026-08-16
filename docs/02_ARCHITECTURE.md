# Architecture

Status: decided — see [[05_DECISIONS]] for rationale, alternatives
considered, and what's explicitly deferred. Structured around the
pipeline in [[00_VISION]]: prospect → research → audit → score → sales
prep → outreach → follow-up → meeting → intake → project → research →
brief → sitemap → copy → website → QA → my approval → client approval →
deployment → maintenance.

This revises the earlier single-Next.js-app draft: the operator now
explicitly wants a Next.js frontend and a Python/FastAPI backend. See
[[05_DECISIONS]] for why that's still a monolith where it matters.

## 1. Architecture diagram

```
                    ┌─────────────────────────┐
                    │  Operator (browser)      │
                    └────────────┬─────────────┘
                                 │ HTTPS
                                 ▼
                    ┌─────────────────────────┐
                    │  apps/web — Next.js (TS)  │
                    │  operator dashboard        │
                    │  + client-approval pages    │
                    └────────────┬─────────────┘
                                 │ REST/JSON (CORS-locked, session cookie)
                                 ▼
                    ┌─────────────────────────────┐
                    │  apps/api — FastAPI (Python)  │
                    │  ── ONE service, modular:       │
                    │  modules/  (14 domains, §3)       │
                    │  agents/   (AI roles, §6)           │
                    │  integrations/ (adapters)             │
                    │  db/       (SQLAlchemy + Alembic)      │
                    └───────┬─────────────────┬─────────────┘
                            │                 │
                            ▼                 ▼
                 ┌────────────────┐  ┌──────────────────────────┐
                 │  PostgreSQL      │  │  External services          │
                 │  (single DB)     │  │  Claude API · Playwright     │
                 └────────────────┘  │  Brave Search · Resend        │
                                       │  Stripe · Vercel/hosting API   │
                                       │  Sentry                         │
                                       └──────────────────────────────┘
```

Client-approval pages in `apps/web` are the one route group that talks
to `apps/api` without operator auth — token-gated instead, see §7.

## 2. Repository structure

```
web-design-os/
├── docs/
├── apps/
│   ├── web/                    Next.js (TypeScript) — dashboard + client
│   │                           approval pages. Talks to apps/api only,
│   │                           never touches Postgres directly.
│   └── api/                    FastAPI (Python) — the whole backend,
│       └── app/
│           ├── modules/        one folder per entity in §3, each with
│           │                   models.py, schemas.py, routes.py,
│           │                   service.py (business logic lives here,
│           │                   not in route handlers)
│           ├── agents/         one file per AI role actually built
│           │                   (§6), plus agents/prompts/ for prompt
│           │                   templates
│           ├── integrations/   thin adapters: llm.py, search.py,
│           │                   browser.py, email.py, hosting.py,
│           │                   payments.py, monitoring.py
│           ├── jobs/           the in-process job runner (§4)
│           ├── db/             SQLAlchemy base + Alembic migrations
│           ├── core/           settings, auth, logging, shared deps
│           └── main.py         FastAPI app assembly, router mounting
├── packages/
│   └── site-templates/         Next.js template(s)/components used to
│                               generate client sites — plain files,
│                               copied/templated by apps/api at build
│                               time, not imported as Python code
└── tests/                      cross-cutting integration/e2e tests,
                                including generated-site QA checks
```

**Structural change from the prior draft:** the original scaffold had
top-level `agents/`, `integrations/`, and `database/` folders as
siblings of `apps/`. Those move inside `apps/api/app/` because they're
Python code that only apps/api imports — making them top-level would
imply they're shared across languages/processes, which they aren't.
See [[05_DECISIONS]].

## 3. Database architecture

Single Postgres database, owned exclusively by `apps/api` — nothing
else connects to it directly. UUID primary keys throughout (`gen_random_
uuid()`), since some IDs (client-approval links) are exposed externally
and must not be sequential/guessable — see [[06_SECURITY]]. One set of
IDs, no separate "public token" column needed.

### Entities

- **businesses** — the canonical company record (name, industry,
  location, ABN if known). One row per real-world business, whether
  it's currently a prospect, a client, both over time, or neither yet.
- **contacts** — people at a business (name, email, phone, role).
  Belongs to a business.
- **leads** — the sales-tracking record for a business being pursued:
  pipeline stage (prospect → meeting), score, source. Belongs to a
  business (0–1 active lead per business at a time).
- **interactions** — every touchpoint on a lead: outreach sent, reply,
  call, note. Doubles as the lead-side activity log.
- **website_audits** — structured audit results (loads, mobile, HTTPS,
  speed, or "no site found") for a business's existing site. Belongs
  to a lead.
- **sales_opportunities** — the deal itself: proposed scope/price/tier
  under discussion. Belongs to a lead; becomes "won" → creates a
  client + project, or "lost".
- **meetings** — scheduled/held meetings with notes and outcome.
  Belongs to a sales_opportunity.
- **clients** — a business that has converted: billing details,
  contract terms. Belongs to a business (1–1, created on won
  opportunity). Deliberately *not* a copy of all business fields —
  just what's client-specific.
- **projects** — the delivery-side unit of work. Belongs to a client;
  a client can have more than one project over time (new site, later
  redesign). Carries its own pipeline stage (intake → maintenance).
- **tasks** — operator/agent to-do items. Belongs to a project (or a
  lead, for sales-side follow-ups).
- **design_briefs** — the structured brief. Belongs to a project.
- **websites** — the generated site record: template used, config,
  content refs, current live status. Belongs to a project.
- **qa_reports** — automated + manual QA results. Belongs to a website.
- **deployments** — one row per deploy event (environment, URL,
  timestamp, status). Belongs to a website.

### Relationships (indented = "belongs to" the line above)

```
businesses
  contacts
  leads
    interactions
    website_audits
    sales_opportunities
      meetings
  clients                (created when a sales_opportunity is won)
    projects
      tasks
      design_briefs
      websites
        qa_reports
        deployments
```

### Activity log: no generic polymorphic table

A single generic `activity_log` table with a polymorphic
`entity_type`/`entity_id` pair was considered and rejected — it's the
classic entity-attribute-value trap: unenforceable foreign keys, ORM
awkwardness, and a query pattern that fights Postgres instead of using
it. Instead: `interactions` is the lead-side log, and a small
`pipeline_events` table (nullable `lead_id`/`project_id`, exactly one
set, via a check constraint) covers stage-transition history where
needed. Simple, typed, still queryable.

## 4. API architecture

- REST/JSON, versioned under `/api/v1`. One router per module in
  `apps/api/app/modules/<domain>/routes.py`, mounted in `main.py`.
- Request/response validation via Pydantic schemas — every inbound
  payload is validated before it reaches a service function.
- Auth: a `Depends()` dependency checks the operator's session cookie
  on every route except client-approval routes (token-gated instead,
  §7) and `/health`.
- **No GraphQL, no tRPC.** REST + FastAPI's auto-generated OpenAPI
  schema, piped through `openapi-typescript` to produce types for
  `apps/web`. That's the entire cross-language contract mechanism —
  no hand-maintained duplicate type definitions, no heavyweight
  generated client SDK, just types + a thin hand-written fetch wrapper.
- **Background work — a job table, not Celery/Redis.** Agent calls,
  site audits, and site generation are triggered via a `jobs` row
  (status: pending/running/done/failed) that an in-process poller in
  `apps/api/app/jobs/` picks up. This survives a process restart
  (the row is the durability mechanism) without standing up a broker.
  Revisit only if job volume or multi-process scaling genuinely
  requires a real queue — not before.
- FastAPI's own `BackgroundTasks` is fine for anything short enough
  to not need that durability (e.g., firing a notification).

## 5. Frontend architecture

- Next.js, App Router, TypeScript.
- `apps/web` never talks to Postgres — everything goes through
  `apps/api` over REST, browser → API directly (CORS locked to the
  web app's origin), no bespoke proxy/BFF layer in Next.js.
- Auth: FastAPI issues an httpOnly, secure, `SameSite=Lax` session
  cookie on login; the browser sends it automatically on API calls.
  No OAuth/multi-provider identity — one operator account.
- Pages mirror the backend modules and the pipeline: a kanban-style
  board for leads/projects by stage (per [[04_ROADMAP]] M1), detail
  pages per entity (`/leads/[id]`, `/projects/[id]/brief`, etc.).
- Client-approval pages are a separate route group, token-gated, no
  operator auth, minimal data exposure (only that project's preview).
- **Data fetching:** server components fetching from the API for most
  pages. Reach for a client-side data library (React Query) only where
  real interactivity demands it (kanban drag-and-drop, optimistic
  updates) — don't default to one everywhere.
- **UI:** Tailwind + shadcn/ui for a clean, practical component set.
  No custom design system — that's real ongoing design work with no
  revenue payoff at this scale.

## 6. AI architecture

AI functionality is modular by construction: each role is a standalone
function in `apps/api/app/agents/<role>.py`, called explicitly by a
module's service layer — agents don't call each other, and there's no
autonomous orchestration loop. The pipeline's stage sequencing *is*
the orchestration; it's driven by API routes and the job runner, not
by agents deciding what to do next.

**Common shape**, every agent:

```python
def run(input: XInput) -> AgentResult[XOutput]:
    ...

class AgentResult(BaseModel, Generic[T]):
    output: T
    confidence: float | None
    flagged_for_review: bool
    notes: str | None
```

`flagged_for_review` is the escape hatch required by [[03_AGENT_RULES]]
— an agent unsure of its own output flags it instead of passing it
through silently. Prompt templates live in `agents/prompts/` as their
own files (not inline strings), so they can be iterated without a code
change and so a stored result can be traced back to the prompt version
that produced it, per [[03_AGENT_RULES]]'s traceability requirement.
All agents call the LLM through one `integrations/llm.py` adapter —
no per-agent API client code, and no multi-provider abstraction layer
until there's an actual second provider to support.

### The ten potential roles, and what's actually being built

Per the operator's instruction: **not all ten are being implemented
now.** Each maps to one future `agents/<role>.py` file; only the first
three are in near-term scope ([[04_ROADMAP]] M2).

| Role | Status | Notes |
|---|---|---|
| Research | M2 | Prospect + build-phase research summarization. |
| Website auditing | M2 | Structured audit from Playwright output. |
| Lead scoring | M2 | Deterministic-ish scoring from research + audit. |
| Sales assistant | M3 | Sales-prep packet + outreach drafting. |
| Meeting preparation | M3/deferred | Build only if meeting volume justifies it. |
| Creative director | M4/deferred | Design brief drafting — high judgment, expect heavy edits. |
| Copywriter | M4 | Per-page copy drafts from intake + research. |
| Website builder | M5 | Assembles a site from template + brief + copy, not a from-scratch generator. |
| Technical QA | M5 | Automated checks (build/links/mobile) — assists, doesn't replace stage 17. |
| Creative QA | Deferred, advisory-only | "Is this design actually good" stays human per [[00_VISION]]. If built at all, it's a second opinion for the operator, never a gate. |

## 7. Security model

Extends [[06_SECURITY]] for the two-service shape:

- **Network boundary:** browser talks to both `apps/web` (pages) and
  `apps/api` (data) directly. `apps/api` CORS is locked to the exact
  web app origin(s) — no wildcard.
- **Auth:** single operator credential; FastAPI-issued httpOnly signed
  session cookie. No multi-tenant identity system.
- **Client-approval routes:** the only unauthenticated surface on
  `apps/api` — gated by an unguessable per-project token, rate-limited,
  scoped to return only that project's preview data.
- **SQL injection:** SQLAlchemy ORM/parameterized queries only — no
  raw string-built SQL.
- **Input validation:** every route validates against a Pydantic
  schema before touching a service function.
- **Untrusted content stays data:** scraped prospect-site text feeds
  agent prompts as data, never as instructions (per
  [[03_AGENT_RULES]]), and is sanitized before being rendered anywhere
  in the dashboard (no raw HTML from a scraped page ever rendered
  as-is — stored-XSS risk).
- **Secrets:** separate `.env` per app, gitignored; production secrets
  live in the hosting platform's env store.
- **No card data ever reaches this system** — Stripe-hosted
  checkout/invoices only.

## 8. Configuration/environment strategy

- Two real environments for now: **local dev** and **production**. No
  hand-maintained staging server — if a pre-prod check is ever needed,
  lean on the hosting platform's own preview deploys rather than
  building one.
- `apps/api`: config via `pydantic-settings`, typed and validated at
  startup — the app fails fast on a missing required var instead of
  failing later mid-request.
- `apps/web`: Next.js's built-in env handling — `NEXT_PUBLIC_*` only
  for what the browser genuinely needs, everything else server-only.
- Every app ships a committed `.env.example` documenting required
  vars, grouped by integration (`LLM_*`, `STRIPE_*`, `RESEND_*`, etc.).
  Real `.env` files are gitignored.
- **Local dev:** docker-compose for Postgres only. Run `apps/web` and
  `apps/api` natively (`next dev`, `uvicorn --reload`) — faster
  iteration than containerizing everything for local work.
  Containerize the apps only if/when the production host requires it.

## 9. Testing strategy

- `apps/api`: pytest. Unit tests for service-layer functions with
  external calls (LLM, integrations) mocked; integration tests against
  a real test Postgres for modules where the query logic itself is the
  risk.
- **Agents:** LLM output is non-deterministic, so tests target the
  deterministic parts — prompt construction, output-schema validation,
  the `flagged_for_review` logic — not exact output content. A small
  set of recorded "golden" responses is enough for regression checks.
- `apps/web`: light — component/unit tests where real logic lives
  (forms, kanban state), not blanket coverage. One Playwright e2e path
  for the critical journey (login → move a lead → generate a site →
  deploy) once that path stabilizes.
- Generated client sites: the stage-16 QA checks (build, links,
  mobile, basic Lighthouse thresholds) double as both a product
  feature and the test suite for build output — reuse, don't duplicate.
- No 100%-coverage goal. Test in proportion to what would actually
  hurt the business if it broke silently — payment and deploy paths
  first, cosmetic UI last.

## 10. Development roadmap

Milestones stay as defined in [[04_ROADMAP]] (M0–M6); M0 is updated to
scaffold both `apps/web` and `apps/api` plus Postgres, rather than a
single app. No milestone content changes here beyond that — see
[[04_ROADMAP]] for the authoritative sequence.

## What would be unnecessarily complicated right now

- A BFF/proxy layer between Next.js and FastAPI — the browser can call
  the API directly.
- GraphQL or tRPC for the frontend/backend contract — REST +
  OpenAPI-generated types is simpler and tRPC can't span the
  TS/Python boundary anyway.
- Celery/Redis for background jobs at one-operator volume — a jobs
  table + in-process poller covers it.
- Splitting `apps/api` into per-domain microservices — one FastAPI
  service, modularized by folder, is the monolith this system needs.
- A generic polymorphic activity-log table — explicit per-domain
  tables instead.
- A multi-LLM-provider abstraction/gateway — one provider, one
  adapter, until a second is actually needed.
- Building all ten AI roles now — three are in near-term scope; the
  rest are designed for, not built.
- A custom design system for the dashboard — Tailwind + shadcn/ui.
- A hand-maintained staging environment — use the hosting platform's
  preview deploys if that need ever materializes.
- Containerizing local dev for both apps — native processes are
  faster to iterate on solo; containerize only for the prod target.

## To be decided

- Exact AU lead-sourcing data source(s) for stage 1 (Google Places API,
  ABN Lookup, directories).
- Whether client sites are plain static exports or per-client Next.js
  apps — depends on how much interactivity the $1,299+ tier needs.
- Production hosting target for `apps/api` (needs a Python-friendly
  host — Fly.io, Railway, Render are candidates; Vercel is the target
  for `apps/web` and generated client sites regardless).

Record the decision and rationale for each in [[05_DECISIONS]] once
made.
