# Roadmap

Status: draft — sequencing, not dated commitments. Every item is here
because it saves time, makes money, reduces mistakes, or improves
quality, per [[00_VISION]]. Cut anything that stops being true. Each
milestone should be independently usable, not a stepping stone that
only pays off once everything after it exists.

**Phase status (2026-08-18):** M0-M3 — "Lead + Sales" — reviewed as a
complete, working phase: full test suites pass (126 backend, 10
frontend), both apps build clean, the full migration chain round-trips
from empty, and multi-user/workspace isolation was audited across every
module with no gaps found. The review surfaced two security gaps —
missing cost/rate limiting and missing SSRF hardening on website
audits — both closed same day, see [[06_SECURITY]] and
[[05_DECISIONS]]. One item remains genuinely open from M1 (project-side
activity log — see that entry). M4 is next.

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
      (web presence, socials, listing) into a structured note. Partial:
      Brave Search results are pulled and folded into the Sales Audit's
      evidence (see below), but there's no standalone structured
      research note independent of generating a Sales Audit yet.
- [x] Website audit agent: Playwright-driven check (loads, mobile,
      HTTPS, speed, no-site-found) → structured report per prospect —
      `agents/website_audit.py`, deterministic, no LLM call.
- [x] Lead score computed from research + audit — `agents/lead_score.py`,
      deterministic rules over the website audit's measured signals, run
      automatically whenever a Sales Audit is generated. See
      [[05_DECISIONS]] for the scoring formula and why it isn't LLM-
      judged.

## M3 — Sales prep + outreach + follow-up

Goal: stages 5–7 stop eating time, sending still stays human.

- [x] Sales prep packet assembled automatically from research + audit —
      `agents/sales_audit.py` / `modules/sales_audits/`: a 9-section
      report (business summary, website strengths, top problems, why
      they matter, recommended improvements, suggested structure,
      talking points, objection handling, suggested offer) generated
      from the website audit + search evidence, surfaced on the lead
      detail page with a "Generate sales audit" action.
- [x] Outreach draft agent, referencing real findings — operator
      reviews and sends (see [[03_AGENT_RULES]]) — `agents/outreach.py` /
      `modules/outreach/`: drafts EMAIL, PHONE, or IN_PERSON talking
      points for a qualified lead, grounded in the website/sales audit
      and any prior outreach already sent, with explicit guardrails
      against fake familiarity/urgency, exaggerated claims, spam
      language, and unnecessary compliments. Drafting only — status only
      ever advances (DRAFTED → APPROVED → SENT → REPLIED/FOLLOW_UP_DUE →
      CLOSED) via an explicit operator action, never automatically. See
      [[05_DECISIONS]].
- [x] Follow-up reminders/sequencing so nothing goes cold from being
      forgotten — `agents/follow_up.py`: given a lead's full outreach
      history, suggests the next channel, a due date, and what to cover,
      surfaced as OVERDUE/DUE TODAY/UPCOMING on the new `/dashboard/
      follow-ups` page (and a "Generate follow-up" action on the lead
      detail page). Every drafting/lifecycle/follow-up action is
      recorded in the activity log with the responsible user.

## M4 — Intake → project → brief/sitemap/copy

Goal: stages 9–14. Signed client's info flows straight into a build
spec with no re-keying.

- [x] Calendar + Client Management — built ahead of the rest of M4, per
      explicit operator direction, as the operational layer both people
      need day to day rather than intake/brief automation. `meetings`
      (previously schema-only, zero routes) is now a real feature:
      scheduled against a lead (sales call) or a project (client
      check-in) — see [[05_DECISIONS]] for why that's the parent shape
      instead of the originally-drafted sales_opportunity. A unified
      `/dashboard/calendar` (month grid) surfaces meetings and open task
      due dates together across both sides of the pipeline; the
      dashboard's `meetings` metric now counts both. Client Management
      gained a `/dashboard/clients/[id]` detail page (editable business
      fields, billing email, contract-signed date, assigned user, linked
      projects, activity history) mirroring the existing lead detail
      page — the first entity besides leads to get one.
- [x] Calendar Integration — Google Calendar, OAuth 2.0, connected
      per-user from Settings (one registered app; each teammate
      individually grants consent). Meetings gained `meeting_type`,
      `status` (scheduled/held/cancelled/no_show), `assigned_user_id`,
      and `duration_minutes`. Booking a lead-side meeting now runs the
      full requested workflow automatically: the lead's status advances
      to MEETING (never regressing one already further along), the
      event is pushed to the assigned user's connected Google Calendar
      (no attendees, no invite email — see [[06_SECURITY]]), and
      `agents/meeting_brief.py` generates a pre-meeting brief from the
      lead's existing sales audit/outreach/meeting history — the
      "Meeting preparation" AI role, previously deferred, per
      [[02_ARCHITECTURE]] §6. Every step is best-effort/non-fatal except
      the meeting booking itself: a missing calendar connection or a
      failed LLM call never blocks scheduling. See [[05_DECISIONS]] for
      the full design and why Google Calendar/per-user/one-directional
      is the "simplest appropriate" scope.
- [x] Client intake form → auto-creates a project record —
      `modules/design_briefs/`: expanded the `design_briefs` stub into
      the full BUSINESS/BRAND/CONTENT/WEBSITE/ASSETS intake, one row
      per project. "Start intake" on a client's page (pre-filled from
      what the CRM already knows, nothing invented) creates the project
      and brief together; the project detail page's Brief section is
      the ongoing editor, saving field-by-field. Every empty field is
      surfaced in `missing_fields` rather than guessed at, and the
      brief is the operator-reviewable/editable source of truth for
      design — "Approve brief" locks it in and advances the project
      past `INTAKE`, and any further edit reverts it to draft. See
      [[05_DECISIONS]].
- [ ] Post-sale research agent.
- [ ] Design brief, sitemap, and copy drafts generated from intake +
      research, for operator sign-off before build — the intake
      collection above is the foundation this reads from; the
      generation step itself (research agent → drafted sitemap/copy)
      is still open.

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
