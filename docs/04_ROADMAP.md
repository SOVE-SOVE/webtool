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
- [x] Overview dashboard: the metrics the operator asked for (total/
      qualified/contacted leads, meetings, won/active projects, revenue,
      tasks needing attention) plus a "Needs your attention" list
      (overdue/undated tasks, leads stale 5+ days). Pulled forward from
      later in the roadmap because it was asked for directly — see
      [[05_DECISIONS]] for exact metric definitions and the schema gap
      that was found and fixed while building it (lead→client
      conversion now records a won opportunity, or won-projects/revenue
      could never move through the UI at all). Reworked 2026-08-21 into
      a ranked "Do this next" list covering follow-ups, imminent
      meetings, and each unfinished project's first unmet approval gate
      alongside the original two signals — every row carries the
      concrete next action and links to the screen where it's done. The
      "meetings" tile (every meeting ever booked) became "upcoming
      meetings", and "follow-ups due" was added. See [[05_DECISIONS]].
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
      recorded in the activity log with the responsible user. Overdue
      and due-today follow-ups also surface on the Overview as of
      2026-08-21 — until then they were only visible to someone who
      thought to open the follow-ups page, which defeats the point of a
      reminder. Marking outreach sent/replied now also advances the
      lead's own status, which previously had to be done by hand. As of
      2026-08-24, `modules/outreach/service.py::list_needs_follow_up`
      also detects leads that have gone quiet with *no* follow-up
      scheduled at all (deterministic, no LLM — reads last contact,
      pipeline stage, meeting outcome, and prior-outreach channel), and
      an existing follow-up can be snoozed rather than only resolved or
      left overdue.
- [x] Sales command centre — `/dashboard/sales`
      (`modules/sales_dashboard/`), added 2026-08-25 as the Phase 3
      checkpoint: a lead-funnel-only view (new/hot/needs-follow-up/
      upcoming-meeting/proposal/won/lost, conversion rate, estimated vs.
      actual revenue, outreach activity) plus a ranked "do this next"
      queue, so "find → qualify → contact → follow up → book → close"
      works as one continuous loop from a single screen rather than
      requiring the Overview plus several list pages. Also closed the
      one real gap blocking an honest "estimated revenue" figure — a
      way to log an actual proposal amount (`POST
      /leads/{id}/opportunities`) — see [[05_DECISIONS]].

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
- [x] Creative Director — built in parallel with the intake work above
      (two concurrent branches; merged same day, see [[05_DECISIONS]]).
      `agents/creative_director.py` / `modules/creative_directions/`:
      turns the business record, latest website audit, latest
      sales-audit research, and — once an intake brief exists — the
      client's own stated `target_customers`/`business_goals` and brand
      material for a project's client into a practical, client-specific
      creative direction (concept, visual/brand/colour/typography/
      image/layout/UX direction, tone of voice, recommended visual
      hierarchy, recommended CTA strategy, things to avoid, references)
      — explicit FACTS vs. ASSUMPTIONS vs. RECOMMENDATIONS throughout,
      never presenting an assumption as a fact. When no intake brief
      exists yet (or it's missing target audience/goals), the operator
      can still type them in at generation time; either way, a genuine
      gap is flagged for review rather than silently producing a
      generic direction. DRAFT → APPROVED status gate with in-place
      editing (`PATCH /creative-directions/{id}`) is the "review and
      edit before continuing" step, surfaced on the same
      `/dashboard/projects/[id]` page as the intake brief.
- [x] Lead-to-client conversion → auto-creates a project record.
      Converting a won lead now creates the Client *and* one INTAKE-stage
      Project (with a starter task checklist) in the same transaction,
      carrying the agreed package/price/deadline and a direct
      traceability pointer back to the lead (`source_lead_id`). There's
      no separate "client intake form" UI — the conversion action itself
      is the trigger, since that's the app's real "became a client"
      event. The project stage pipeline was also redesigned to the
      12-stage set the operator specified for this workflow. See
      [[05_DECISIONS]]. Note: a client can end up with two projects if
      both flows are used (one from conversion, one from "Start
      intake") — each flow creates its own project rather than reusing
      one, consistent with "a client can have more than one project
      over time."
- [ ] Post-sale research agent.
- [x] Sitemap/planning system — `agents/sitemap.py` / `modules/sitemaps/`:
      given a project's client brief and (where one exists) its
      creative direction, recommends a website structure — which pages
      to build and why, primary/secondary CTA, key sections, required
      content, required functionality, and navigation relationships
      (parent/child nesting for e.g. service-detail pages, primary/
      footer nav placement). Deliberately selective per the operator's
      brief: the prompt is built around *not* defaulting to every
      common page (Testimonials/FAQ/Blog/Portfolio are judgement calls,
      not defaults) — see `agents/prompts/sitemap.md`. Unlike the
      brief/creative-direction's text-block fields, pages are real rows
      (`sitemap_pages`, self-referential parent) because the operator
      must add/edit/remove/reorder individual pages, not just replace a
      block of text — surfaced on `/dashboard/projects/[id]` as an
      editable, reorderable page tree with the same DRAFT → APPROVED
      gate as the brief/creative direction; "Approve" marks the sitemap
      as the structural source of truth for the (not-yet-built)
      site-generation step. Generates no website code, per the
      operator's explicit scope for this piece.
- [ ] Copy drafts generated from intake + research, for operator
      sign-off before build — the intake collection, Creative Director,
      and sitemap above are the foundation this reads from.

## M5 — Website build + QA + approval

Goal: stages 15–18. First real reusable output.

- [x] First template/component package in [[packages]] — the build
      baseline instead of a blank canvas. `packages/site-templates`: 17
      section components (nav, hero, CTA, service cards, features,
      testimonials, pricing, FAQ, contact, image/content split, gallery,
      footer, form, stats, logos, team, portfolio) built on 8 shared
      primitives (Section, Container, Heading, Button, Media, Card,
      CardGrid, Form), each driven entirely by a typed config object —
      no section fetches data or invents content. A registry maps every
      section type to its component plus metadata (sitemap PageTypes it
      suits, required config fields), so the future generator queries
      `getSectionsForPageType()` instead of hardcoding which section
      goes where. `validateSection()` flags missing required fields
      without ever filling them in. See [[05_DECISIONS]].
- [x] Anti-Slop quality evaluator — `agents/anti_slop.py`, deterministic
      (no LLM call, mirrors `agents/lead_score.py`), the "quality floor"
      from [[01_REQUIREMENTS]] made checkable rather than aspirational.
      Takes a proposed site's section configs (the same shape
      `packages/site-templates` renders) and scores them 0-100 against
      explicit rules: generic/cliche copy, repeated phrasing across
      pages, unverified superlative claims, testimonials/statistics with
      no match in a supplied "authentic content" pool, stock-photo hosts
      and placeholder alt text, repetitive/card-heavy page structure,
      and (once the generator reports them) heavy gradients/
      glassmorphism/rounded-corners/animation. Missing required content
      is reported separately as `missing_information`, never scored as
      a defect — this system flags gaps, it never fabricates to fill
      them. Now wired into the generator below (every generation and
      section-regeneration runs through it). See [[05_DECISIONS]].
- [x] Site generation from brief + sitemap + copy + client assets —
      `agents/website_generator.py` / `modules/websites/`: given a
      project's approved sitemap (falling back to the latest one, same
      resolution convention as creative direction), assembles navigation
      + footer + one section list per sitemap page using
      `packages/site-templates`' section shapes, composing only real
      brief/sitemap fields — a service page with an unstructured prose
      blob gets a Hero with that text as its subheading rather than
      invented service cards, and sections with no honest source
      (pricing, team, portfolio, stock imagery with real alt text) are
      simply not built, with the gap reported in `missing_information`
      instead. Deterministic like the lead-scoring/audit agents, not
      LLM-drafted — see [[05_DECISIONS]] for why. Every generation is a
      new versioned `Website` row (same "newest reviewed first"
      convention as Sitemap/CreativeDirectionBrief) so prior versions
      stay reviewable; approving or hand-editing a section's content
      mutates that version in place instead. A full regeneration carries
      forward every already-approved section by default (opt into
      `force_regenerate_all` to discard them), and a single section can
      be regenerated on its own — matched back into the fresh output by
      (page, section type), which creates a new version but leaves every
      other section, including its id and approval state, untouched.
      Surfaced on a dedicated `/dashboard/projects/[id]/website` page
      (not the main project page, unlike brief/creative-direction/
      sitemap — this needed materially more room): version picker, a
      quality-score/issues panel, a missing-information panel, and one
      card per section with Approve/Edit (a JSON config editor — no live
      visual preview yet, see [[05_DECISIONS]])/Regenerate actions.
      Verified end-to-end in a real browser (not just the 31 backend +
      existing frontend tests) — that pass caught and fixed a real bug
      where regenerating a section didn't refresh the version dropdown.
- [x] Automated QA checks (build, links, mobile) from [[tests]] —
      `agents/technical_qa.py` / `modules/qa_reports/`: six categories
      (performance, responsiveness, accessibility, SEO, functionality,
      security), each check reported as pass/fail/warning/skipped with
      a severity and recommended fix — nothing is ever silently
      omitted, including what can't be checked yet (see below).
      Deterministic, no LLM call. Most checks run statically against
      the generated config: real, fully-static wins here include
      broken-internal-link detection (every href checked against the
      site's actual page slugs), missing alt text, unlabeled form
      fields, duplicate `<h1>`s, exposed-secret and injected-script
      scanning, and (closing a real gap found while building this)
      page titles/meta descriptions, now generated from real brief
      fields only — see [[05_DECISIONS]]. Checks that need a rendered
      page (real asset weight, computed colour contrast, console
      errors, cross-viewport overflow, robots.txt/sitemap.xml) only run
      given a live `preview_url`, via a new `fetch_qa_signals` in
      `integrations/browser.py` reusing `fetch_page_signals`'s SSRF
      guard; without one — true for every site today, since M6
      deployment doesn't exist yet — they're reported `skipped`, never
      dropped from the report. `ready_for_client_review` is false
      whenever any check both failed and is `critical` severity,
      matching "not ready until critical issues are resolved" verbatim.
      One QA report per run (not overwritten), same versioning
      convention as `Website`. Verified for real: the live-check
      pipeline was run against a deliberately broken local HTML fixture
      (wide overflowing div, a console.error, a low-contrast paragraph,
      a real broken link) outside the test suite — same reasoning as
      why `fetch_page_signals` itself has never been test-suite-driven
      — and every signal it reported (overflow at all 3 viewports,
      the exact console message, the exact broken path, a genuinely
      low ~1.16:1 contrast ratio, real transferred bytes) was correct.
      Surfaced as a "Technical QA" panel on the website page: a
      pass/fail badge, counts, and every check grouped by category.
- [x] Operator approval gate — grew into a full human-approval-workflow
      system (`modules/approvals/`) rather than a single gate: seven
      checkpoints (client brief, creative direction, sitemap, generated
      website, QA, client review, final deployment), each recording
      who/when/notes and, for the three that didn't already have it
      (website, QA, deployment), a new schema field for it. No stage
      can be silently skipped or bypassed — every approval action
      checks its own prerequisites server-side and 400s with exactly
      what's missing, and the deployment gate independently re-verifies
      all six prior checkpoints' *current* state rather than trusting
      an earlier gate already covered it. See [[05_DECISIONS]].
- [ ] A secure shareable client-preview link with feedback capture —
      still not built. "Client review" today is an operator recording
      that the client approved (by email/call/etc, see
      [[03_AGENT_RULES]]'s existing "Client approval communication"
      note), not the client viewing/interacting with anything
      themselves — there's no client-facing surface in this app at all
      yet.

## M6 — Deployment + maintenance

Goal: stages 19–20. Close the loop to revenue.

- [x] One-step deploy to hosting, tied to client approval. Deployment is
      now a real prepare/execute lifecycle, not just the checkpoint-7
      approval record: `POST .../deployments` still gates on every prior
      checkpoint (unchanged) plus new pre-deploy checks
      (`modules/deployments/checks.py` — required assets/config, no
      secret-shaped content in the generated site, a domain on file
      where a real target would need one, the specific QA report's own
      critical-issue count) and creates a `pending` row; a separate
      `POST .../deployments/{id}/execute` actually publishes it through
      `integrations/deployment.py`'s provider abstraction, landing on
      `success`/`failed` with a URL or error. Only `MockDeploymentProvider`
      exists — no real hosting account is configured, so nothing here is
      a live, publicly reachable site; a real provider is a new class
      behind the same interface, not a flag that makes this one lie.
      Rollback/version selection re-runs a prior *successful* deployment
      of an older website version, re-verifying that version's own
      approval/QA/client-review flags first. See [[05_DECISIONS]].
- [x] Provider-agnostic deployment adapter architecture (phase 6 part 2)
      — `integrations/deployment.py`'s single-file mock became a real
      package (`integrations/deployment/`): a `DeploymentProvider`
      interface (`validate_config`/`build`/`deploy`/`get_status`/
      `rollback`), a shared static-site build step
      (`build.py::build_static_site`, config -> real HTML/CSS files —
      minimal but genuinely deployable, not a port of `packages/
      site-templates`), and real adapters for Vercel, Netlify,
      Cloudflare Pages, and traditional (FTP/FTPS) hosting alongside
      the existing mock, selected via `DEPLOY_PROVIDER` — still
      defaults to `mock`, and every real provider fails loudly rather
      than silently deploying through mock when its own credentials
      (env-var-only, never hardcoded — see `.env.example`) aren't set.
      `Deployment` gained `provider_ref` (a real provider's own
      deployment id) for status polling and provider-native rollback
      (Netlify's own restore API; every other provider falls back to
      re-running build+deploy, same as before). Deployment is still
      never automatic — `execute_deployment` remains a separate,
      explicit call from `create_deployment`. See [[05_DECISIONS]].
- [x] Delivery workflow completed (phase 6 part 2) — the deploy step
      above now has a "monitor -> receive URL -> verify -> deliver"
      tail: `POST .../deployments/{id}/check-status` re-polls a real
      provider's own status (a no-op refresh for every provider today,
      since none of them have an async build to watch yet — the real
      extension point for one that does); `POST .../deployments/{id}/
      verify` reuses `integrations/browser.py`'s SSRF-guarded
      `fetch_page_signals` to confirm a real deployment's URL actually
      loads (a `mock` deployment is recorded as a simulated pass — its
      URL was never reachable in the first place, see
      `integrations/deployment/mock_provider.py`), setting
      `Deployment.verified_at`. `Project` gained `delivered_at`/
      `delivered_by_user_id`, set only by the new `POST /projects/{id}/
      deliver`, which refuses (`GET .../delivery-status` reports every
      reason why, all at once) unless the latest deployment succeeded
      *and* was verified *and* every item on the final delivery
      checklist — the existing post-launch handover tasks seeded on
      first deploy (`DEFAULT_LAUNCH_TASK_TITLES`) — is checked off.
      Advances the project to `COMPLETE`. Surfaced on the project page
      as a "Verify"/"Check status" pair on each deployment row and a
      `DeliveryPanel` (checklist + "Mark project delivered") alongside
      the existing deployment history/rollback UI. See [[05_DECISIONS]].
- [ ] Payment/invoicing (Stripe) tied to the deploy step.
- [ ] Maintenance monitoring (uptime, broken links) for live client
      sites — the entry point for recurring revenue.

## M7 — Lead Intelligence: automated prospect discovery

Goal: stage 1 (PROSPECT) stops being "the operator thinks of a business
by hand." Upstream of M2 — M2 automates research/audit/score for a lead
already sitting in the CRM; M7 finds and vets the candidate *before* it
becomes a lead at all, kept in its own `discovered_businesses` subtree
until a human explicitly imports one.

- [x] Discovery: `DiscoveryProvider` adapter interface (never a concrete
      provider referenced by the service layer) with
      `BraveSearchDiscoveryProvider` as the one real adapter today —
      `modules/discovery/`. Normalized results, deduplicated against
      both existing CRM businesses and prior discoveries in the same
      workspace.
- [x] Research: real DOM-inspected signals (official site,
      reachability, HTTPS, metadata, mobile viewport, contact/social
      presence) classified as confirmed / inferred / unavailable, never
      asserted as fact beyond what was actually measured — cached for 7
      days rather than re-fetched. `agents/business_research.py`.
- [x] Website quality audit: deterministic, evidence-based findings
      (availability, security, mobile, performance, conversion path,
      business info, visual structure) — `agents/website_quality.py`.
- [x] Opportunity scoring: deterministic, no LLM call, same philosophy
      as M2's lead score — plus a separate evidence-completeness flag
      that routes a low-confidence score to a human instead of trusting
      the number outright. `agents/opportunity_score.py`.
- [x] Human review + CRM import: a review list (approve/reject/archive,
      bulk-approve), and import creates a `Business` + `Lead` (reusing a
      matched existing `Business` rather than duplicating it), carrying
      the research forward as a real `WebsiteAudit` row.
- [x] Job queue (`apps/api/app/jobs/` — `SKIP LOCKED` claim, retry with
      an attempt cap) built as part of this milestone, per the design
      docs/02_ARCHITECTURE.md §4 had described since 2026-08-16 but no
      prior milestone had implemented. Exists so scheduled discovery has
      somewhere to run; nothing schedules discovery through it yet.
- [ ] Scheduled/recurring discovery runs (the poller doesn't drive
      discovery yet — sources are run on demand only).
- [ ] A second real provider behind `DiscoveryProvider` (Google Places,
      ABN lookup, ...) — only Brave Search exists today.

See [[05_DECISIONS]]'s 2026-08-22 entry for the full per-stage
reasoning and commit-by-commit breakdown.

## Explicitly not roadmapped

- Multi-tenant/team features — this is a one-operator system by design.
- A generic no-code site builder, a custom CMS, or a multi-agent
  orchestration framework — see "what this is deliberately not" in
  [[02_ARCHITECTURE]]. (A job queue *was* on this list until M7 — see
  above; it turned out to be the right call once scheduled discovery
  needed somewhere to run.)
- Anything that doesn't map to a pipeline stage in [[00_VISION]].

Record why a milestone's scope changed in [[05_DECISIONS]] rather than
rewriting history here.
