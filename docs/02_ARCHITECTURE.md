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
                                       │  Google Calendar (OAuth)       │
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
│           │                   browser.py, google_calendar.py,
│           │                   email.py, hosting.py, payments.py,
│           │                   monitoring.py
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

### Workspace and users (added 2026-08-16)

Two new root entities sit above the business-domain tree described
below, per [[01_REQUIREMENTS]] "Multi-user & workspace":

- **workspaces** — `id`, `name`, `created_at`, `updated_at`. The
  top-level tenant boundary. One row today, but the schema supports
  more without changing shape.
- **users** — `id`, `workspace_id`, `name`, `email` (unique), `role`
  (`admin` | `member`), `password_hash`, `created_at`, `updated_at`.
  Belongs to exactly one workspace.

`businesses.workspace_id` is the single point where the rest of the
business-domain tree (below) is scoped to a workspace — every
descendant table reaches its workspace by following its existing FK
chain up to `businesses`, rather than duplicating `workspace_id` onto
every table. `leads`, `clients`, `projects`, and `tasks` additionally
carry a nullable `assigned_user_id` (FK → `users.id`, `ON DELETE
SET NULL`) so those four record types — the ones [[01_REQUIREMENTS]]
calls out as carrying responsibility — can be handed to a specific
user. Unassigned is a valid, common state, not an error.

Auth changes accordingly: session cookies now carry a user id (not an
email), and every operator-auth route dependency resolves the full
`User` row so route handlers can filter by `current_user.workspace_id`
and check `current_user.role`. See §7.

### Entities

- **businesses** — the canonical company record (name, industry,
  location, ABN if known, email, social links, notes), scoped to a
  workspace via `workspace_id`. One row per real-world business,
  whether it's currently a prospect, a client, both over time, or
  neither yet.
- **contacts** — people at a business (name, email, phone, role).
  Belongs to a business.
- **leads** — the sales-tracking record for a business being pursued:
  a CRM-style `status` (NEW → ... → WON/LOST/NURTURE — see
  [[05_DECISIONS]], not the 20-stage pipeline), `priority`, score,
  source, notes, and a nullable `archived_at`. Belongs to a business
  (0–1 active lead per business at a time).
- **interactions** — every touchpoint on a lead: outreach sent, reply,
  call, note. Doubles as the lead-side activity log.
- **website_audits** — structured audit results (loads, mobile, HTTPS,
  speed, or "no site found") for a business's existing site. Belongs
  to a lead.
- **sales_opportunities** — the deal itself: proposed scope/price/tier
  under discussion. Belongs to a lead; becomes "won" → creates a
  client + project, or "lost".
- **meetings** — a scheduled meeting: `title`, `meeting_type`
  (`sales_call` | `client_check_in` | `other`, defaulted from the
  parent), `status` (`scheduled` → `held` | `cancelled` | `no_show`),
  `scheduled_at`, `duration_minutes`, `notes`, `outcome`,
  `assigned_user_id`, and `external_event_id` (the synced Google
  Calendar event id, nullable — see integrations/google_calendar.py and
  [[06_SECURITY]]). Belongs to exactly one of a lead (sales-side calls)
  or a project (post-sale client check-ins) — the same dual-parent shape
  as `tasks`, not a sales_opportunity as originally drafted here. See
  [[05_DECISIONS]] (2026-08-18, Calendar + Client Management and
  Calendar Integration).
- **meeting_briefs** — an auto-generated pre-meeting brief (summary,
  talking points, open items), synthesized by `agents/meeting_brief.py`
  from a lead's existing sales audit/outreach/meeting history when a
  lead-side meeting is booked. Belongs to a meeting, 1–1; project-side
  meetings don't get one.
- **calendar_connections** — one user's connected Google Calendar
  (`google_email`, `encrypted_refresh_token`, `calendar_id`). Belongs to
  a user, 1–1 — not scoped under `businesses.workspace_id` like the rest
  of this tree, since it's a personal integration credential, not
  workspace business data. Reaches its workspace via `user_id →
  users.workspace_id` when it needs to (it doesn't; nothing lists
  connections across users).
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
workspaces
  users
    calendar_connections    (user_id, 1-1 — personal, not workspace data)
  businesses              (workspace_id)
    contacts
    leads                  (assigned_user_id)
      interactions
      website_audits
      sales_opportunities
      meetings               (lead_id XOR project_id — assigned_user_id)
        meeting_briefs         (1-1, lead-side meetings only)
    clients                (assigned_user_id; created when a sales_opportunity is won)
      projects              (assigned_user_id)
        tasks                (assigned_user_id)
        meetings               (lead_id XOR project_id — assigned_user_id)
        design_briefs
        websites
          qa_reports
          deployments
  activity_log             (workspace_id, user_id, entity_type/entity_id)
```

### Activity log(s): entity-specific stays entity-specific; user attribution gets one polymorphic table

A single generic `activity_log` table covering *everything* (stage
history included) was considered and rejected for the reasons in the
original entry below — it's the classic entity-attribute-value trap:
unenforceable foreign keys, ORM awkwardness, a query pattern that
fights Postgres. That reasoning still holds for stage/domain history:
`interactions` is the lead-side log, and `pipeline_events` (nullable
`lead_id`/`project_id`, exactly one set, via a check constraint) covers
stage-transition history.

**Added 2026-08-16:** a *second*, narrower `activity_log` table now
covers a different concern those don't: **which user did what**, across
every entity type a user can touch (lead, client, project, task).
Columns: `id`, `workspace_id`, `user_id` (FK → `users.id`, `ON DELETE
SET NULL` — the log outlives the user), `entity_type`, `entity_id`,
`action`, `summary`, `created_at`. `entity_type`/`entity_id` here *is*
the polymorphic pair the original decision avoided, and that trade-off
(no enforced FK on `entity_id`) is accepted deliberately this time: the
alternative — a `created_by`/`updated_by` user FK plus per-action rows
duplicated onto `leads`, `clients`, `projects`, and `tasks` individually
— is strictly more code for the same guarantee, and this table is
read as one combined feed ("what has my co-founder been doing"), which
is exactly the shape a polymorphic table is good at and per-table
columns are bad at. See [[05_DECISIONS]].

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
  No OAuth/multi-provider identity — email+password against the
  `users` table, one workspace per account (see §3, §7).
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
| Meeting preparation | Built 2026-08-18 | `agents/meeting_brief.py` — auto-runs when a lead-side meeting is booked, synthesizing existing lead info (no new data fetched). See [[05_DECISIONS]] (Calendar Integration). |
| Creative director | Built 2026-08-19 | `agents/creative_director.py` — creative concept, visual/brand/colour/typography/image/layout/UX direction, tone of voice, visual hierarchy, CTA strategy, things to avoid, references, with an explicit FACTS/ASSUMPTIONS/RECOMMENDATIONS split. High judgment, expect edits — DRAFT→APPROVED review gate before it's treated as final. See [[05_DECISIONS]]. |
| Copywriter | M4 | Per-page copy drafts from intake + research. |
| Website builder | M5 | Assembles a site from template + brief + copy, not a from-scratch generator. |
| Technical QA | M5 | Automated checks (build/links/mobile) — assists, doesn't replace stage 17. |
| Creative QA | Deferred, advisory-only | "Is this design actually good" stays human per [[00_VISION]]. If built at all, it's a second opinion for the operator, never a gate. |

## 7. Security model

Extends [[06_SECURITY]] for the two-service shape:

- **Network boundary:** browser talks to both `apps/web` (pages) and
  `apps/api` (data) directly. `apps/api` CORS is locked to the exact
  web app origin(s) — no wildcard.
- **Auth (revised 2026-08-16):** per-user credentials backed by the
  `users` table; FastAPI-issued httpOnly signed session cookie carrying
  a user id. Still no OAuth/external identity provider for *signing in*
  to this app, and still a single signed cookie — only what it
  identifies changed (a user, not a fixed email). This is
  workspace-scoped multi-user, not a multi-tenant *identity* system: no
  SSO, no per-record permission grants, just two roles (`admin`/
  `member`) and one workspace per account. See [[01_REQUIREMENTS]]
  "Multi-user & workspace" and [[05_DECISIONS]]. (Google Calendar OAuth,
  added 2026-08-18, is a separate, per-user *outbound* integration
  connection — see below — not an identity provider for this app.)
- **Google Calendar OAuth tokens (added 2026-08-18):** only a refresh
  token is persisted, Fernet-encrypted at rest
  (`CALENDAR_TOKEN_ENCRYPTION_KEY`, see app/core/crypto.py) — never
  plaintext, per [[06_SECURITY]]. Access tokens are fetched on demand
  and never stored. The OAuth `state` param is signed (itsdangerous,
  its own salt) and checked against the authenticated session on
  callback — standard CSRF defense, not just "any validly-signed state
  is accepted." Sync is one-directional (this app pushes meeting events
  out, never reads the connected calendar back) and never sets
  attendees or triggers a Google invite email — see
  integrations/google_calendar.py.
- **Authorization:** every non-public route resolves the current user
  and filters data to `current_user.workspace_id` — no cross-workspace
  reads are possible through the API. User-management and workspace-
  settings routes additionally require `role == admin`; every other
  route (leads, clients, projects, tasks, activity) is readable/
  writable by any workspace member, matching [[01_REQUIREMENTS]]'s
  "MEMBER: view all workspace data" — there is no per-record ACL beyond
  workspace membership.
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
