# Roadmap

Status: draft — sequencing, not dated commitments. Every item is here
because it saves time, makes money, reduces mistakes, or improves
quality, per [[00_VISION]]. Cut anything that stops being true. Each
milestone should be independently usable, not a stepping stone that
only pays off once everything after it exists.

## M0 — Foundations

Goal: an empty but real, deployed, secured app to build on.

- [x] Repo structure and documentation baseline (this).
- [x] Core stack decided — see [[02_ARCHITECTURE]] and [[05_DECISIONS]].
- [x] `apps/web` (Next.js) and `apps/api` (FastAPI) scaffolded per
      [[02_ARCHITECTURE]], behind auth (no unauthenticated access to
      any client data). Verified locally end to end, including in a
      real browser. **Not yet deployed to a public host** — that's the
      one item left in this milestone, and needs the operator's own
      hosting accounts (Vercel, and a Python-friendly host for
      `apps/api`). See [[05_DECISIONS]].
- [x] Postgres database provisioned locally (docker-compose),
      `apps/api` connected via SQLAlchemy/Alembic. Production database
      (Neon/Supabase) is part of the deploy step above, not yet done.
- [x] Core schema: all 14 entities from [[02_ARCHITECTURE]] §3, plus
      `pipeline_events`, migrated and verified against local Postgres.
- [x] Logging (stdlib, both apps), global error handling (FastAPI
      catch-all handler + Next.js error/global-error boundaries),
      and a real test suite for both apps (pytest against a genuine
      Postgres test database, Vitest for frontend logic) — the
      operator refers to this hardening pass as "Milestone 1"; it
      closes out the foundations milestone rather than starting a new
      one. See [[05_DECISIONS]].

## M1 — Manual pipeline, digitized

Goal: replace the spreadsheet. Every stage in [[00_VISION]] exists as a
record the operator can see and move by hand — no automation yet.

Built as what the operator calls "the first usable dashboard" — a
second, unrelated use of "Milestone 1" from the M0 hardening pass; see
the note on that entry above. Don't read the two as the same thing.

- [x] CRUD for leads, clients, projects, and tasks — plain sortable
      tables with inline stage/done editing, not a kanban board. A
      drag-and-drop kanban view was the original plan here; a table
      does the same job (see and move a record through its stages) with
      far less UI work, which matters more at this scale. Revisit only
      if list-scanning stops being fast enough as volume grows.
- [x] Overview dashboard: the 8 metrics the operator asked for (total/
      qualified/contacted leads, meetings, won/active projects, revenue,
      tasks needing attention) plus a "Needs your attention" list
      (overdue/undated tasks, leads stale 5+ days). Pulled forward from
      later in the roadmap because it was asked for directly — see
      [[05_DECISIONS]] for exact metric definitions and the schema gap
      that was found and fixed while building it (lead→client
      conversion now records a won opportunity, or won-projects/revenue
      could never move through the UI at all).
- [ ] Activity log per prospect/project (what happened, when) —
      partially done: the lead detail page (added alongside the lead-
      management rework, see [[05_DECISIONS]]) now surfaces a per-lead
      history feed from the existing `activity_log` table, which
      already records every create/status-change/assign/archive event.
      Projects still have no equivalent view. `pipeline_events` — the
      table originally slated for this — remains unwired; `activity_log`
      turned out to cover the "what happened, when" need directly, so
      building `pipeline_events` on top would be redundant unless a
      future need specifically wants project/lead stage-transition
      history separate from user-attributed activity.
- [x] This alone should already beat "a spreadsheet + memory" — shipped
      before automating anything.

## M2 — Research + audit + score automation

Goal: stages 2–4 stop being manual.

- [ ] Research agent: given a business name/URL, pull public info
      (web presence, socials, listing) into a structured note.
- [x] Website audit agent: static HTML/CSS analysis (not the originally
      planned Playwright rendering — see [[05_DECISIONS]] for why) of
      technical/SEO/performance/mobile/accessibility/conversion/design,
      each finding tagged verified-fact/inference/subjective-observation,
      SSRF-safe fetch, stored per lead with a generated markdown report.
      Rendering-dependent checks (contrast, true responsive behavior,
      visual/typography quality) are explicitly marked not-measured
      rather than approximated.
- [ ] Lead score computed from research + audit.

## M3 — Sales prep + outreach + follow-up

Goal: stages 5–7 stop eating time, sending still stays human.

- [ ] Sales prep packet assembled automatically from research + audit.
- [ ] Outreach draft agent, referencing real findings — operator
      reviews and sends (see [[03_AGENT_RULES]]).
- [ ] Follow-up reminders/sequencing so nothing goes cold from being
      forgotten.

## M4 — Intake → project → brief/sitemap/copy

Goal: stages 9–14. Signed client's info flows straight into a build
spec with no re-keying.

- [ ] Client intake form → auto-creates a project record.
- [ ] Post-sale research agent.
- [ ] Design brief, sitemap, and copy drafts generated from intake +
      research, for operator sign-off before build.

## M5 — Website build + QA + approval

Goal: stages 15–18. First real reusable output.

- [ ] First template/component package in [[packages]] — the build
      baseline instead of a blank canvas.
- [ ] Site generation from brief + sitemap + copy + client assets.
- [ ] Automated QA checks (build, links, mobile) from [[tests]].
- [ ] Operator approval gate, then a secure shareable client-preview
      link with feedback capture.

## M6 — Deployment + maintenance

Goal: stages 19–20. Close the loop to revenue.

- [ ] One-step deploy to hosting, tied to client approval.
- [ ] Payment/invoicing (Stripe) tied to the deploy step.
- [ ] Maintenance monitoring (uptime, broken links) for live client
      sites — the entry point for recurring revenue.

## Explicitly not roadmapped

- Multi-tenant/team features — this is a one-operator system by design.
- A generic no-code site builder, a custom CMS, a multi-agent
  orchestration framework, or a job queue — see "what this is
  deliberately not" in [[02_ARCHITECTURE]].
- Anything that doesn't map to a pipeline stage in [[00_VISION]].

Record why a milestone's scope changed in [[05_DECISIONS]] rather than
rewriting history here.
