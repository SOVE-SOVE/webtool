# Workflow Audit — current vs. intended Web Design OS flow

Date: 2026-09-01
Scope: audit only, no code changes (task T1).
Purpose: map the workflow the app actually implements today, compare it
to the intended "walk in and say *I made this for you*" flow, and list
the concrete gaps + the changes that close them. Feeds tasks T2–T5.

The visual design, design system, colours, typography, spacing and
navigation styling are **not** in scope and are not faulted here — the
problems below are all about *steps, hand-offs and where data has to be
re-entered*, not how anything looks.

---

## 1. CURRENT WORKFLOW (as built)

### Stage map

| # | Stage | Where it happens | How the user moves to the next stage |
|---|-------|------------------|--------------------------------------|
| 1 | **Discover** | `/dashboard/discovery` → "New search" form (`discovery/page.tsx`) creates + runs a `DiscoverySearch` synchronously | Click the search row |
| 2 | **See results** | `/dashboard/discovery/[id]` — map + results table (`discovery/[id]/page.tsx`) | Click a business name, or go to Review queue |
| 3 | **Auto research/audit/score** | Job queue: `create_and_run_search` → `_enqueue_research` → `business_research` → `website_quality_audit` → `opportunity_score` (all automatic, no user action) | Automatic |
| 4 | **Deep-dive (optional)** | `/dashboard/discovered-businesses/[id]` — research facts, quality findings, score breakdown, re-run buttons | — |
| 5 | **Review / triage** | `/dashboard/review` — cross-search queue: Approve / Reject / Archive / Bulk approve / **Add to CRM** (`review/page.tsx`) | **Approve** sets status `approved` and *nothing else happens*. User must then click **"Add to CRM"** (a separate button, or "Add lead" on the results table) which calls `POST /discovered-businesses/{id}/import` → `import_to_lead` |
| 6 | **Lead exists in CRM** | `import_to_lead` creates a `Business` + `Lead` (priority derived from score, research/audit/score digest copied into `lead.notes`, a `WebsiteAudit` row carried over). Discovered business flips to `imported`. | Open the lead |
| 7 | **Work the lead** | `/dashboard/leads/[id]` — edit business/lead fields, generate Sales Audit, generate Outreach drafts, log a proposal, generate follow-ups | — |
| 8 | **Win the deal** | `/dashboard/leads/[id]` → "Convert to client" section → "Mark WON — convert" → form (package, price, deadline, project name, billing email, assignee) → confirm dialog → `POST /clients` with `from_lead_id` | `create_client` marks the lead `WON`, creates a `Client`, closes/creates a WON `SalesOpportunity`, **and creates one `Project` at `INTAKE`** with starter tasks |
| 9 | **Build the website** | `/dashboard/projects/[id]` (build artifacts) + `/dashboard/projects/[id]/website` (build workspace). Sequence: fill **Project brief** → approve it → **Generate creative direction** → approve → **Generate sitemap** → approve → **Generate website** → approve internally → **Run QA** → sign off QA → **Record client approval** → **Deploy** | Each step is a manual generate + a manual approve. Some chaining exists server-side: `approve_sitemap` enqueues `website_generate` → `qa_report`. |
| 10 | **Show the client / feedback** | `/dashboard/projects/[id]/website` → Preview tab + `PreviewLinksPanel` (secure preview token) + `WebsiteFeedbackPanel`. A QA run that returns `ready_for_client_review` auto-creates an internal "Request client review" task. | — |
| 11 | **Deploy** | Website workspace → Deployment tab → `DeploymentPanel` (needs every approval gate green) | — |
| 12 | **Maintain** | Project stage `MAINTENANCE` / `COMPLETE` | — |

### Discovery-related routes (four)

- `/dashboard/discovery` — **list of past searches** + the "New search"
  form. This is the only Discovery item with primary nav weight
  (`nav.ts:62`). The page itself is a *table of search history*, not a
  workspace — no map, no results, no businesses on it.
- `/dashboard/discovery/[id]` — **one search's results**: filters, the
  Leaflet map (`DiscoveryMap`), the results table with per-row website
  status, score, and an "Add lead" action. Reached only by clicking a
  search row. Not in nav.
- `/dashboard/discovered-businesses/[id]` — **one business deep-dive**:
  research/audit/score detail with re-run buttons. No list route at
  `/dashboard/discovered-businesses`.
- `/dashboard/review` — **cross-search triage queue**, rendered as a
  `secondary` nav item indented under Discovery. 13-column table:
  Business, Location, Website, Audit summary, Score, Confidence, Key
  problems, Sales angle, Source, Researched, Status, Actions (+ select
  checkbox). Actions per row: Research again, Approve, Reject, Archive,
  **Add to CRM**.

### Account / user management (T4 area)

- `workspaces` (tenant boundary), `users` (belongs to one workspace,
  role `admin` | `member`), business data scoped via
  `businesses.workspace_id`.
- `POST /api/v1/users` is **admin-only** (`require_admin`), hashes the
  password (`hash_password`), rejects duplicate email. No public
  `/register` route exists, frontend or backend. Login page has no
  "create account" link.
- Settings → **People** section already has an admin-only "Add
  teammate" form (name / email / temporary password / role) and inline
  role editing, with a guard that refuses to demote the last admin.

### Overview dashboard (T5 area)

`/dashboard/page.tsx` today renders, in order:
1. A 10-tile metric grid (`GET /dashboard/overview` + `GET
   /sales-dashboard`): Active leads, Qualified, Contacted, Hot leads,
   Follow-ups due, Upcoming meetings, Active projects, Won deals,
   Pipeline value, Revenue won.
2. **Quick actions** — 5 link buttons (Add lead, Find leads, Run
   website audit, Create project, View follow-ups).
3. **Hot leads** list + **Recent wins** list (from `/sales-dashboard`).
4. **Recent activity** feed (`GET /activity`, last 12).

Plus the global **"Do this next"** attention queue (`DoThisNext`),
pinned to the bottom of *every* dashboard page by `layout.tsx` — it is
not part of the Overview page itself.

---

## 2. INTENDED WORKFLOW

```
DISCOVER
  ↓
REVIEW
  ↓
AUTO SCORE / QUALIFY
  ↓
APPROVE
  ↓
AUTOMATICALLY ADD TO CRM
  ↓
CREATE / ADD TO PROJECT
  ↓
GENERATE INITIAL WEBSITE
  ↓
SHOW THE BUSINESS OWNER
  ↓
(if interested) CONTINUE EDITING ON THEIR REQUESTS
  ↓
DEPLOY
  ↓
MAINTAIN
```

Product principle: **the initial website is built before the owner
agrees to anything.** The owner does not take part in the initial
creative process. The operator walks in with a finished demo.

The user should never feel they must: manually move leads through
extra stages, re-enter information, copy data between modules, hunt for
hidden buttons, learn CRM jargon, complete a long onboarding, or write
a project brief before anything useful happens.

---

## 3. GAPS BETWEEN CURRENT AND INTENDED

### G1 — Discovery is split across a history table and a hidden workspace *(T2)*
The nav's "Discovery" lands on a **list of past searches**. The actual
work — search, map, results, review, add — only exists on
`/dashboard/discovery/[id]`, which has no nav entry and is reachable
only by clicking a history row. A first-time user opening "Discovery"
sees a table with a "New search" button and no indication that this is
where businesses get found. The map, the results and the review
actions are one click away on a route they can't see.
Impact: the single most important screen in the funnel is not the one
the nav points at. "This is where I find businesses" is not obvious.

### G2 — "Approve" and "Add to CRM" are two separate actions *(T3)*
In the Review queue, **Approve** only sets `status = approved`. It does
not create anything. The user must then find and click **"Add to
CRM"** (or "Add lead" on the results table). Two buttons, two mental
steps, for what the intended flow describes as one transition
("APPROVE → AUTOMATICALLY ADD TO CRM"). The `approved` status is
currently a dead end that carries no consequence.
Impact: textbook "unnecessary manual action" + "hunt for hidden
button." Also: bulk-approve approves but imports nothing, so a batch of
20 "approved" businesses still sits outside the CRM.

### G3 — The Review queue speaks pipeline-internal language *(T3)*
13 columns including "Confidence", "Audit summary", "Key problems",
"Sales angle", "Source", "Researched" date, plus a **Status** dropdown
filter exposing all 8 internal states (new / researched / audited /
scored / approved / rejected / archived / imported) and a "Research
again" action. The operator has to understand the internal research →
audit → score pipeline to read the table.
Impact: "complicated CRM terminology", "understand complicated internal
pipeline terminology" — called out explicitly in the task.

### G4 — A website cannot be built before the deal is won *(biggest gap)*
A `Project` only comes into existence through `create_client`, which
**requires marking the lead `WON`** ("Mark WON — convert"). There is no
other path: `POST /projects` needs a `client_id`, and a `Client` is
only created by winning a lead (or the manual "add client without a
lead" referral path). So the build pipeline — brief, creative
direction, sitemap, generate, preview — is gated behind a status that
means "they already said yes."
This directly contradicts the core product principle. The operator
cannot walk in with a finished demo, because the demo can't be started
until after the conversation that the demo is supposed to open.

### G5 — Building the initial website is ~10 manual generate/approve steps *(future task, note only)*
From a fresh project to a previewable site:
fill brief → approve brief → generate creative direction → approve →
generate sitemap → approve → generate website → approve website.
Every generate and every approve is a separate click on a
`Disclosure`-collapsed panel. Only sitemap-approval → generate →
QA is chained. For a demo that the client hasn't asked for and won't
see the internals of, most of these approvals are ceremony.
Impact: "manually manage too many steps." Not in T2–T5's stated scope,
but it's the deepest source of the "too complicated" feeling and
should be a follow-up task.

### G6 — Data is re-entered at the lead→client→project boundary *(minor)*
`import_to_lead` copies research/score context into `lead.notes` as
free text (not structured fields). At conversion the operator re-types
package, price, deadline, project name, billing email, assignee — none
of which are carried from anything discovery already knew. The convert
form and the "New project" form and the "add client" form each collect
overlapping subsets of the same fields.
Impact: "repeatedly enter information", "manually duplicate information
between modules."

### G7 — Overview is half dashboard, half task list *(T5)*
Quick Actions duplicates the nav. Recent Activity is an
undifferentiated event log (`X created lead`, `Y changed status of…`)
that answers "what happened" not "what needs attention" — and the
"what needs attention" job is already done better by the global "Do
this next" queue right below it. The metric grid mixes "active leads"
with "revenue won" with no grouping.
Impact: the page doesn't cleanly answer "what is happening in my
business right now?"

### G8 — No website-lifecycle visibility anywhere at a glance *(T5)*
There is no metric or list for: sites being generated, sites ready to
present, sites awaiting client feedback, sites deployed, sites in
maintenance. This data exists (`Project.stage`,
`Website.workflow_status`, `Deployment.status`, the
`ready_for_client_review` QA state) but no aggregate query exposes it.
Impact: the "WEBSITES" section the intended dashboard calls for has no
backing endpoint today.

### G9 — "Do this next" is present but competes with three other "what to do" surfaces
Global `DoThisNext` queue (bottom of every page) + Overview Quick
Actions + Overview Recent Activity + the Sales page's own
`do_this_next`. The genuinely useful one (server-ranked attention
queue) is the least prominent.

---

## 4. RECOMMENDED CHANGES

### For T2 — one Discovery workspace
- Make `/dashboard/discovery` **the workspace**: search controls (the
  existing form, always visible or one toggle away), the existing
  `DiscoveryMap`, the results table, website-status badges, per-row
  review/add actions — i.e. move the body of `discovery/[id]/page.tsx`
  onto the index route, defaulting to the most recent search's results.
- Keep past-search history as a secondary element on the same page (a
  compact selector / "recent searches" strip), not a separate
  destination.
- Keep `/dashboard/discovery/[id]` working as a permalink to a specific
  search (redirect or render the same workspace scoped to that id) so
  existing links and the "Load more" flow don't break.
- Keep `/dashboard/discovered-businesses/[id]` as the detail route — it
  is genuinely a different job (deep-dive) and is only ever reached by
  drilling in.
- Do **not** rebuild the map, the filters, or the results table — reuse
  `DiscoveryMap`, `lib/filters.ts`, and the existing row markup.
- Reconsider whether `/dashboard/review` stays separate. Its unique
  value is *cross-search* triage + bulk approve. Option A: fold it into
  the Discovery workspace as an "All results / Needs review" tab.
  Option B: leave it as the `secondary` nav item it already is. T3
  simplifies its contents regardless.

### For T3 — approve = in CRM
- `approve_business` (or a new `approve_and_import`): after setting
  `approved`, immediately call the **existing** `import_to_lead`.
  Reuse it, do not duplicate lead-creation.
- On `import_to_lead` failure (`DuplicateLeadError`, `CannotImportError`,
  research not ready, provider/db error): **do not** leave the business
  `approved`-and-silently-not-imported. Surface the error; keep the
  business in a retryable review state (`scored`/`new`, not `approved`)
  so the user sees it still needs action.
- If the business already maps to a CRM business with a lead
  (`DuplicateLeadError`): don't create a duplicate, mark it resolved
  against the existing lead, tell the user "already in CRM as <lead>".
  Preserve the existing dedup (`duplicate_of_business_id`,
  `find_existing_business_match`).
- Bulk approve → bulk approve **and import**, same per-row error
  handling, report how many imported / skipped / failed.
- Strip the Review queue to: Business, Location, Website status,
  Score (single "hot/warm/cold · N" chip), one "Why review" line
  (the recommended sales angle or top problem), **Approve**, **Reject**.
  Move Confidence / Source / Researched / Audit summary / Key-problems
  into the deep-dive route or a row expander. Drop the internal-status
  dropdown filter (keep a simple "show archived/rejected" toggle).
- Remove the standalone "Add to CRM" button (approve now does it) and
  the "Research again" action (it belongs on the deep-dive).
- After approve, the new lead should be visible in `/dashboard/leads`
  (it already is once `import_to_lead` runs) and the Discovery/Review
  rows should reflect `imported` + link to the lead (already built).

### For T4 — two-user management
- Largely **already implemented**. Verify and, if needed, tighten:
  - Settings → People "Add teammate" form works end-to-end (it calls
    `api.createUser`). Confirm the created teammate can log in.
  - `POST /users` stays `require_admin`; `member` role cannot reach it.
  - No password is echoed back after creation (`UserRead` must not
    include `password_hash` — verify the schema).
  - Keep the "can't demote last admin" guard.
  - Optional polish: a one-line explanation in the People section of
    Account vs Workspace vs User, and wording that this is a fixed
    internal team (no invites, no signup). No new infrastructure, no
    migration expected — the schema already supports it.

### For T5 — Overview as a real dashboard
- **Remove** the Quick Actions section and the Recent Activity section.
- Regroup into labelled dashboard modules, each metric a real query:
  - **Leads** — total, new, qualified, needs-follow-up (have:
    `total_leads`, `qualified_leads`, `contacted_leads`,
    `follow_ups_due`; `new_leads_count` from sales-dashboard).
  - **Sales** — hot opportunities, upcoming meetings, in active sales
    process (proposals), won (have: `hot_leads_count`,
    `upcoming_meetings_count`, `proposals_count`, `won_deals_count`).
  - **Projects** — active projects, projects needing attention
    (derive from the existing `_project_attention_items` /
    `needs_attention` where `kind == "project"`).
  - **Websites** — needs a **new** lightweight aggregation
    (`GET /dashboard/overview` extension or a `websites` summary
    endpoint) counting projects by `Website.workflow_status` /
    `Project.stage` / `Deployment.status`: generating, ready to
    present, awaiting client feedback, deployed, maintenance. Do not
    fake these — add the query or omit the sub-metrics that have no
    source.
  - **Follow-ups** — overdue, due today, upcoming (sales-dashboard
    `needs_follow_up` + `/follow-ups` buckets already split these).
  - **Revenue** — won revenue (`revenue_cents` / `actual_revenue_cents`),
    open pipeline value (`estimated_revenue_cents`).
- Keep the global "Do this next" queue where it is (bottom of page) —
  it already covers the "what needs attention" job; do not re-add a
  task list to the Overview body.
- Preserve every existing card/metric component, spacing, dark mode.

### Beyond T2–T5 (recommend as a follow-up task) — close G4 + G5
- Allow a **project (and therefore a website) to be created directly
  from an approved/​imported lead**, before WON — e.g. a "Build a demo
  site" action on the lead that creates a lightweight `Project` (or a
  pre-client "demo" object) wired to the same build pipeline, without
  a `Client` or a WON opportunity. Convert-to-client later attaches the
  existing project instead of making a second one.
- Collapse the brief → creative direction → sitemap → website approval
  chain for the *initial demo* into a single "Generate demo site"
  action that runs the whole chain with sensible auto-approval, leaving
  the granular approve gates for the post-client-feedback iterations.

---

## 5. FILES / MODULES THAT WOULD BE AFFECTED

### T2 (Discovery workspace)
- `apps/web/src/app/dashboard/discovery/page.tsx` — becomes the workspace
- `apps/web/src/app/dashboard/discovery/[id]/page.tsx` — logic moves to index / becomes a scoped view or redirect
- `apps/web/src/components/DiscoveryMap.tsx` — reused as-is
- `apps/web/src/lib/filters.ts` (+ `filters.test.ts`) — reused
- `apps/web/src/lib/nav.ts` (+ `nav.test.ts`) — only if Review is folded in
- `apps/web/src/app/dashboard/review/page.tsx` — only if folded in
- `apps/web/src/lib/api.ts` — no change expected (endpoints already exist)
- No backend changes expected.

### T3 (approve → auto-CRM)
- `apps/api/app/modules/discovery/service.py` — `approve_business`,
  `bulk_approve` call `import_to_lead`; error/rollback handling
- `apps/api/app/modules/discovery/routes.py` — response shape for
  approve (return import result / error), bulk-approve result
- `apps/api/app/modules/discovery/schemas.py` — `BulkApproveResult`
  extension, approve response
- `apps/api/tests/` — `test_discovery*.py`, review/import tests
- `apps/web/src/app/dashboard/review/page.tsx` — column cull, action cull,
  approve wording, success/error states
- `apps/web/src/app/dashboard/discovery/[id]/page.tsx` (or the T2
  workspace) — the results-table "Add lead" action follows the same
  approve-imports rule
- `apps/web/src/lib/api.ts` — `approveDiscoveredBusiness` /
  `bulkApproveDiscoveredBusinesses` return types

### T4 (two-user management)
- `apps/api/app/modules/users/{routes,service,schemas}.py` — verify
  only; confirm `UserRead` has no `password_hash`
- `apps/api/app/modules/auth/routes.py` — verify no register path
- `apps/web/src/app/dashboard/settings/page.tsx` — optional copy polish
- `apps/api/tests/test_users*.py`, `test_auth*.py` — coverage for
  admin-creates-teammate, member-forbidden, teammate-login
- No migration expected.

### T5 (Overview dashboard)
- `apps/web/src/app/dashboard/page.tsx` — remove Quick Actions + Recent
  Activity, regroup metrics into modules
- `apps/web/src/lib/overview.ts` (+ `overview.test.ts`) — shape changes
- `apps/api/app/modules/dashboard/{service,schemas,routes}.py` — **new**
  website-lifecycle counts (generating / ready / awaiting feedback /
  deployed / maintenance) and any leads/follow-up split not already
  present
- `apps/api/app/modules/sales_dashboard/*` — reused for sales counts
- `apps/web/src/components/ui/Metric.tsx` — reused
- `apps/api/tests/test_dashboard*.py` — new metric coverage

### Follow-up (G4/G5, not T2–T5)
- `apps/api/app/modules/projects/*`, `apps/api/app/modules/clients/*`,
  `apps/api/app/modules/leads/*`, the approvals/website/sitemap/
  creative-direction chain, `apps/web/src/app/dashboard/leads/[id]/page.tsx`.

---

## 6. Summary — what each task should feel like when done

- **T2**: open Discovery → immediately see search box, map, results.
  No hidden second screen.
- **T3**: tick Approve → the business is a lead in the CRM. One action.
  Review queue reads like a shortlist, not a pipeline console.
- **T4**: admin adds the one teammate from Settings; teammate logs in;
  teammate can't add users. Nothing else.
- **T5**: Overview answers "what's happening right now" in grouped
  modules of real numbers — no action buttons, no event log.
- **(Follow-up)**: build a demo site straight from an approved lead,
  before the client says yes.
