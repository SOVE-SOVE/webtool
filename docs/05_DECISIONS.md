# Decisions

added agent-to-agent trust boundary because upstream errors like a bad lead score could otherwise propagate silently into outreach drafts"

A running log of decisions and the reasoning behind them, so later work
doesn't silently re-litigate settled questions. Newest entries at the
top. Each entry: date, decision, why, alternatives considered (if any).

---

## 2026-08-25 — Sales Command Centre (Phase 3 checkpoint): a lead-funnel-only dashboard, plus the missing piece that makes "estimated revenue" a real number

**Decision:** Built `modules/sales_dashboard/` (`GET /api/v1/dashboard/sales`)
as a *separate* endpoint from the existing Overview (`modules/dashboard/`),
not an extension of it. The Overview spans the whole business — sales
*and* delivery — and already has its own "do this next" list and metric
tiles; this one is scoped to the sales funnel only (every query is a
`Lead`, never a `Project`), matching the requested "find -> qualify ->
contact -> follow up -> book -> close" shape. Sharing one endpoint would
have meant either bloating the Overview's payload with sales-only detail
nobody asked it to carry, or forking its "do this next" ranking logic to
handle two unrelated audiences (a generalist running the whole shop vs.
someone specifically doing sales work today) inside one function.

Reuses `AttentionItem` (kind/label/id/title/detail/action/href) from
`modules/dashboard/schemas.py` for the new "do this next" queue rather
than inventing a parallel shape — extended its `kind` union with three
sales-only values (`hot_lead`, `stale_proposal`, `new_lead`) alongside
the existing `follow_up`/`meeting`. The queue's ranking follows the same
"urgency first" convention as the Overview's list (see the 2026-08-21
entry below) — overdue follow-up > imminent meeting > hot uncontacted
lead > follow-up due today > stale proposal > stale new lead — with a
second-order tiebreak on *opportunity* (fit score / proposed price)
within each urgency tier, which the Overview's queue doesn't need since
it isn't ranking deals against each other.

**The estimated-revenue gap:** `SalesOpportunity` (existing model) was,
before this change, only ever created with `status=WON`, and only from
one call site — `clients/service.py`'s conversion flow. Nothing in the
app ever created an `OPEN` opportunity, so "estimated revenue" (sum of
open, real quoted amounts) had no honest source — every open lead would
have summed to a hardcoded `$0`, indistinguishable from a genuinely
empty pipeline. Rather than fabricate an estimate (e.g. average deal
size x open-lead count, weighted by stage) — which is exactly the kind
of unsupported claim this codebase has consistently rejected elsewhere
(see the 2026-08-22 opportunity-scoring entry's "industry is deliberately
not a scored factor" reasoning) — this pass added the missing real
capability: `POST /leads/{id}/opportunities` lets the operator log an
actual proposal/quote (tier + price), creating an `OPEN`
`SalesOpportunity` and advancing the lead to `PROPOSAL` (new
`leads/service.py::mark_proposal_sent`, same forward-only contract as
`mark_contacted`/`mark_replied`). `estimated_revenue_cents` sums exactly
those rows. A lead sitting at `PROPOSAL` with no quote logged (e.g. via
the pre-existing direct `PATCH .../leads/{id}` status edit) contributes
`$0` — the honest answer, not a guessed placeholder.

The mirror action, `POST /opportunities/{id}/mark-lost`
(`leads/service.py::mark_lost`), closes an open quote and sets the
lead to `LOST` in the same call — deliberately never reopening an
already-`WON` lead (a stale/superseded quote marked lost after the deal
closed some other way shouldn't reopen the question), the same
asymmetric-terminal-state handling `mark_lost`'s docstring spells out.
While touching this path, also fixed `SalesOpportunity.closed_at` never
being set on the `WON` row `clients/service.py` creates on conversion —
present in the schema since it was first added, but no call site had
ever written to it, so every "recently won" list would have shown a
blank close date.

**won_deals / lost_deals counted off `Lead.status`, not
`SalesOpportunity.status`:** `Lead.status` is the single field every
other part of this app already treats as authoritative for "where is
this lead in the pipeline," and it's reachable even when no opportunity
was ever logged (a lead marked `LOST` by a direct status edit, with no
quote ever recorded). Counting off `SalesOpportunity` instead would
silently undercount those. The `recent_won`/`recent_lost` *lists* still
enrich each lead with whatever `SalesOpportunity` row exists for
price/tier context — always present for `WON` (the conversion flow
guarantees it) but possibly absent for `LOST`, which the schema makes
explicit by typing `proposed_price_cents`/`tier` as nullable rather than
defaulting them to zero.

**conversion_rate_pct is decided-only** (`won / (won + lost)`), not
`won / total_leads_ever`. Dividing by every lead ever created would
understate a healthy, simply-mid-flight pipeline; this answers "of the
deals I've actually closed one way or the other, how many did I win,"
and is `null` (not `0%`) when nothing has been decided yet — same
"missing is not zero" discipline as the estimated-revenue figure above.

**Why:** requested directly — "complete Phase 3 with a sales command
centre" — with an explicit acceptance bar ("find -> qualify -> contact
-> follow up -> book -> close" must work end to end) and an explicit
usefulness bar ("the operator could open it every morning and
immediately know what needs to happen"). The existing Overview already
covered the whole-business version of "what do I do next" (see the
2026-08-21 entry below); what was missing was a sales-specific view an
operator running today's sales work could open without wading through
delivery-side rows, plus the one real data gap (a loggable proposal
amount) blocking "estimated revenue" from being anything but a lie.

**Alternatives considered:** Extending `DashboardOverview` with sales-
specific fields instead of a new endpoint — rejected for the reasons
above (audience/payload mismatch, ranking-logic fork). Inferring
estimated revenue from lead score / stage without a real logged amount
— rejected as unfounded, the same call this codebase already made for
industry-based opportunity scoring. A generic "deal value" field on
`Lead` itself instead of extending `SalesOpportunity` — rejected;
`SalesOpportunity` already exists as "the deal under discussion" per its
own docstring, and a lead can accumulate more than one over time (a
re-quote after scope changes), which a single scalar field on `Lead`
can't represent.

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

## 2026-08-25 — Calendar integration retrofit onto a provider-adapter architecture; meeting attendees and reminders

**Decision:** Superseded the 2026-08-18 calendar entry's "one provider,
one adapter, until a second is actually needed" call. A second is now
needed — a `MockCalendarProvider` for development/testing without a
real Google account — and the operator asked directly for a
swappable-provider architecture with no provider hard-coded into the
domain logic. Retrofit the existing, already-working Google Calendar
integration (`modules/calendar/`, `integrations/google_calendar.py` —
both untouched) behind a new `CalendarProvider` `Protocol` +
dict-registry pair (`integrations/calendar/base.py` +
`integrations/calendar/registry.py`), the exact same shape
`integrations/discovery/` already uses for business-discovery
providers. `modules/meetings/service.py` now calls
`calendar_registry.get_provider()` and codes only against
`CalendarEventInput`/`CalendarProvider` — it no longer imports
`integrations.google_calendar` or `modules.calendar.connections` at
all. `GoogleCalendarProvider` wraps the existing OAuth/HTTP client
unchanged; `MockCalendarProvider` is always "connected," never makes a
network call, and returns an obviously-synthetic
`mock-event-<uuid4>` id — the same "can't be mistaken for the real
thing" contract `integrations/deployment.py`'s `MockDeploymentProvider`
already established. New `settings.calendar_provider` (default
`"google"`, not `"mock"` — unlike `deploy_provider`, Google Calendar
here is a real, already-working integration, so defaulting away from
it would silently regress existing behavior; `CALENDAR_PROVIDER=mock`
is the explicit local-dev/test opt-in).

Also added, since the operator's spec named them explicitly and
neither existed: `MeetingAttendee` (`meeting_attendees` table — name,
email, organizer flag; purely informational) and `MeetingReminder`
(`meeting_reminders` table — `remind_at`, optional note,
`acknowledged_at`). Attendee emails are carried on
`CalendarEventInput.attendee_emails` for provider awareness but
`GoogleCalendarProvider._to_meeting_event` deliberately drops them
before calling `google_calendar.create_event` — the existing "never
send a calendar invite email" guarantee
(`integrations/google_calendar.py`'s module docstring) had to survive
the refactor unchanged, not get an opt-out via a new field. Reminders
are `IN_APP`-channel only: this app has no email/SMS/push delivery
integration anywhere, so a reminder is a stored time that becomes
visible once due (`GET /api/v1/meetings/reminders/due`, surfaced as a
banner on the calendar page) — never a claim that a notification was
actually sent. "Meeting history" itself needed no new mechanism:
`activity_log` (`entity_type="meeting"`) already recorded every
scheduled/updated/status_changed/cancelled/brief_generated event;
`GET /api/v1/meetings` gained optional `lead_id`/`project_id` filters
so the lead and project detail pages could each get a "Meetings"
section (new) showing that entity's full meeting history, past and
upcoming.

**Why:** the operator asked directly for "Design the system so Google
Calendar and other calendar providers can be added cleanly. Do not
hard-code a provider into the domain logic. Provide a mock calendar
provider for development/testing" — an explicit, direct instruction
that supersedes the earlier internal call, the same way
`integrations/discovery/`'s Protocol+registry pattern was chosen for
exactly this reason when Lead Intelligence needed it. Keeping the
"no invite emails" and "no fake reminder delivery" guarantees intact
through the refactor matters more here than usual: an adapter
architecture that silently made either easier to violate would be a
regression dressed up as a feature.

**Alternatives considered:** A generic `notification_channel` field on
`MeetingReminder` covering email/SMS/push — rejected; every one of
those would need a real sending integration this app doesn't have, and
adding the field without the integration would be the exact "claims a
capability nothing backs" pattern this codebase consistently avoids
(see Anti-Slop, the mock deployment/discovery providers, Sales Audit's
sourcing discipline). Passing `attendee_emails` all the way into
Google's real `attendees` field — rejected outright per the operator's
own prior "no unnecessary emails" instruction; attendee tracking is a
CRM/informational feature here, not an invite-sending one.

---

## 2026-08-24 — Outreach system request: extended the existing M3 feature (fourth channel = follow-up message drafting, plus editing) instead of rebuilding

**Decision:** A request came in to "build an AI-assisted outreach
system" — email/phone/in-person/follow-up drafts grounded only in real
findings, editable before sending, history stored, never auto-sent. That
system already existed (M3, 2026-08-18: `agents/outreach.py` /
`modules/outreach/`). Rather than building a parallel or replacement
system, extended the existing one to close its two actual gaps against
the request:

1. **Follow-up MESSAGE drafting**, added as a fourth
   `OutreachChannel.FOLLOW_UP` value alongside email/phone/in_person —
   same `EmailDraft` output shape as email, own prompt
   (`agents/prompts/outreach_follow_up.md`) with guardrails specific to
   follow-ups (never claim a reply/read/urgency the prior-outreach record
   doesn't actually show). `generate_outreach` refuses with a 400 when no
   prior outreach exists for the lead — a follow-up message referencing
   contact that never happened is exactly the fabricated-relationship
   invention this feature exists to prevent, so it's enforced structurally
   rather than left to the prompt. Deliberately kept separate from
   `agents/follow_up.py`/`follow_ups` (the existing next-touch scheduling
   recommendation) — that's a different, already-correct concept and nothing
   about it changed.
2. **Editing before send**, which had no route at all —
   `PATCH /api/v1/outreach/{id}`. Refuses once a message has actually gone
   out (SENT/REPLIED/FOLLOW_UP_DUE/CLOSED — editing then would misrepresent
   what was really sent) and reverts an APPROVED message back to DRAFTED on
   edit, matching the "content changed → approval no longer covers it"
   contract this codebase already applies everywhere else (brief, creative
   direction, sitemap, website sections — see several entries below).

Storage, lifecycle (DRAFTED → APPROVED → SENT → REPLIED/FOLLOW_UP_DUE →
CLOSED), guardrail prompts for the other three channels, and "store
generated outreach history" (one `OutreachMessage` row per generation,
never overwritten) were all already correct and untouched.

**Why:** [[03_AGENT_RULES]]'s "check 05_DECISIONS/07_SESSION_LOG before
starting work" exists precisely to prevent this class of accidental
rebuild. Both gaps closed are read directly off the request's own
wording ("follow-up message" as one of four generated types; "allow the
operator to edit everything before sending") against what the existing
code actually did, not assumed.

**Alternatives considered:** Making `agents/follow_up.py` draft message
content itself instead of adding a fourth outreach channel — rejected;
it would conflate two contracts (a scheduling recommendation vs. a
send-ready draft) that the existing schema already keeps cleanly
separate (`FollowUp` vs. `OutreachMessage`), and `FollowUp.channel`
would then need to exclude its own table's new "value" nonsensically.
Allowing edits on a SENT message (with a "this changes the historical
record" warning) instead of refusing outright — rejected; every other
send-adjacent checkpoint in this app (approve, deploy) treats "already
happened" as immutable, not warn-and-allow.

---

## 2026-08-25 — Email outreach integration: provider adapter, explicit operator send action separate from approval, per-attempt send history

**Decision:** Built the actual dispatch path for EMAIL-channel outreach
(`app/integrations/email.py`, plus `modules/outreach/service.py`'s
`send_outreach_email`). Before this, `agents/outreach.py` could draft an
email and `approve_outreach`/`mark_outreach_sent` could record its
lifecycle, but nothing in the app ever actually sent one — "mark sent"
was pure bookkeeping for a message the operator sent by hand outside the
app. This closes that gap with a real provider integration:

1. **Adapter architecture**, mirroring `integrations/deployment.py`'s
   shape exactly: an `EmailProvider` interface, a `MockEmailProvider`
   (default, never makes a network call, records every message on
   itself for tests) and a `ResendEmailProvider` (the one real provider,
   per [[02_ARCHITECTURE]]'s integration list), selected by
   `get_email_provider()` off `settings.email_provider`. Never a
   concrete provider referenced from the service layer. An unconfigured
   or unknown provider raises (`EmailProviderError`) rather than
   silently falling back to mock — same "fail loud on misconfiguration"
   contract `get_deployment_provider()` already established.
2. **Compose is a distinct step from send.** `compose_email()` validates
   and packages an already-drafted/approved subject/body/recipient into
   an `EmailMessage` — it never invents content; that's still
   `agents/outreach.py`'s job. A `ResendEmailProvider` network error or
   non-2xx response is caught inside the provider and returned as a
   failed `EmailSendOutcome`, never raised past it — a provider hiccup
   is recorded like any other send failure, not an unhandled exception.
3. **Sending is a separate explicit action from approving, never
   combined.** `send_outreach_email` requires `status == APPROVED` —
   never `DRAFTED` — enforcing [[03_AGENT_RULES]]'s "the operator must
   explicitly approve a message before sending" as a hard 400, not a
   convention. Approving and sending are two distinct operator clicks on
   two distinct existing/new endpoints (`/approve`, then
   `/send-email`), so there is no path where approval itself triggers a
   send.
4. **Every send attempt is its own `EmailSend` row** (new table), not a
   field on `OutreachMessage`. A failed attempt leaves the message at
   `APPROVED` — retryable — and records `error_message` on its own row;
   a success flips the message to `SENT` via the same
   `_apply_sent_side_effects` helper `mark_outreach_sent` already used
   (Interaction + lead `CONTACTED` bump + activity log), refactored out
   so a system-dispatched send and an operator's manual "I sent it
   myself" bookkeeping produce identical downstream effects. This is
   the "record sent email" / "email history" / "failure handling"
   requirement made structural: a lead's email history is the full
   sequence of attempts, successes and failures both, never overwritten
   on retry. `GET /api/v1/leads/{id}/emails` surfaces it, newest first.
5. **Recipient resolution never invents an address.** The primary
   contact's email if one's on file, else the business's own email,
   else a 400 before any provider is even touched — same "flag the gap,
   don't fabricate" posture the rest of this codebase holds.

**Why:** the operator-stated requirement was explicit — "never send
AI-generated outreach automatically without explicit operator action" —
and the previous state (a "mark sent" that sent nothing) meant the app
couldn't actually dispatch email at all, only track that a human did it
elsewhere. Splitting approve/send into two actions, and failed sends
into their own retryable rows, makes both the approval gate and the
failure-handling requirement checkable rather than aspirational.

**Alternatives considered:** Folding send outcome fields directly onto
`OutreachMessage` (a `send_status`/`send_error` pair) instead of a new
`email_sends` table — rejected: a retry would either overwrite the
previous failure's record or need ad hoc versioning, and "email
history" was an explicit, separate requirement from the message's own
lifecycle status. Auto-sending immediately on approval (one action
instead of two) — rejected outright; it's exactly the "never send
automatically" case the requirement calls out, even if approval already
implies operator intent.

---

## 2026-08-22 — Lead Intelligence (Phase 2): discover → research → audit → score → human review → CRM import, plus the job queue

**Decision:** Built the layer upstream of the existing sales pipeline —
finding and vetting prospective businesses before a human decides one is
worth pursuing — as its own `discovered_businesses` subtree, kept
strictly separate from `businesses`/`leads` until an operator explicitly
imports one. Landed across seven commits (`c807d41` through `0aa1b7e`):

1. **Architecture** (`c807d41`) — `discovery_searches` /
   `discovered_businesses` (a search and its normalized, deduplicated,
   source-tracked results), `business_research_results` (confirmed vs.
   inferred vs. unavailable fields, cached rather than re-fetched),
   `website_quality_audits` / `opportunity_score_results` (structured
   findings and scoring history), and — separately from the discovery
   feature itself — the `jobs` table + in-process poller
   (`apps/api/app/jobs/runner.py`, `SKIP LOCKED` claim, retry with an
   attempt cap) that docs/02_ARCHITECTURE.md §4 had described since
   2026-08-16 but that no prior pass had actually built. It exists now
   so scheduled discovery has somewhere to run later; nothing schedules
   discovery through it yet.
2. **Business discovery** (`71372b9`) — a `DiscoveryProvider` protocol +
   adapter registry (never a concrete provider referenced by the
   service layer), with `BraveSearchDiscoveryProvider` as the one real
   adapter, reusing the same Brave Search integration Sales Audit
   already used. Dedup checks both existing CRM businesses and prior
   discoveries in the same workspace before creating a second review
   item for something already known.
3. **Website research** (`cf908d7`) — real DOM inspection via a new
   Playwright signal-fetcher (reusing the existing SSRF guard), mapped
   onto official site / reachability / HTTPS / metadata / mobile
   viewport / contact presence / social presence, plus two judgment
   calls that stay honest about their limits: an inferred site age from
   a regex-found copyright year (always caveated), and a
   template/placeholder flag that's only ever `True` (literal
   placeholder text found) or `None` — never a guessed `False`. A result
   less than 7 days old is reused rather than re-fetched.
4. **Website quality analysis** (`f0e46f3`) — deterministic (no LLM
   call) findings across availability, security, mobile usability,
   performance, conversion path, business info, and visual structure,
   each with category/severity/message/evidence/confidence. A category
   this app can't honestly measure produces no finding rather than a
   guessed one; an unreachable site short-circuits to a single
   availability finding.
5. **Opportunity scoring** (`9821090`) — also deterministic, same
   philosophy as the existing per-lead `agents/lead_score.py`: more
   fixable problems on an otherwise-reachable site score better than a
   site with no problems found, and a missing/unreachable site scores
   highest of all (a blank canvas is the easiest pitch). A separate
   `REVIEW` flag is driven by *evidence completeness*, not by the score
   itself — a number built from too little measured signal is flagged
   for a human rather than trusted outright. Industry is deliberately
   not a scored factor: this app has no real conversion data by
   industry, and inventing a weighting would be exactly the
   unsupported claim this whole feature exists to avoid.
6. **Review + CRM import** (`da504a8`) — the human checkpoint: a review
   list surfacing every discovered business with its research/quality/
   score context folded in, approve/reject/archive (individually or
   bulk-approve), and import — which creates a `Business` + `Lead` (or
   reuses an existing matched `Business` instead of duplicating it),
   carries the research forward onto a real `WebsiteAudit` row, and
   folds the full research/quality/score narrative into the new lead's
   notes rather than dropping it at the CRM boundary. An already-
   imported business is locked against further review action.
7. **Live-test fixes** (`0aa1b7e`) — running the real pipeline end to
   end against live Brave Search (10 real Gold Coast plumbing/
   electrician businesses) surfaced two edge cases neither the mock
   provider nor synthetic fixtures had: a dedup false positive when two
   different real businesses shared a generic search-result title with
   no location context (fixed by requiring real location context before
   the name-only fallback applies), and a name-extraction gap on a
   business name containing a colon.

Ends at 554 backend tests (475 architecture-baseline + 79 across the
six feature passes), 42 frontend tests, both suites green.

**Why:** Mirrors [[00_VISION]]'s pipeline spine — "find business" is a
real pipeline stage, not something the operator should have to do by
hand indefinitely — while holding the line the rest of this codebase
holds: an agent proposes, a human decides. Every discovery/research/
scoring step is deterministic and evidence-based (no LLM call anywhere
in this pass) specifically so a false claim can always be traced back
to a real, inspectable signal rather than a model's guess; nothing
reaches `businesses`/`leads` — the tables the rest of the app trusts —
without a human's explicit import action.

**Note:** This entry was written 2026-08-24, two days after the work
landed — the original seven commits never touched this log, breaking
the pattern every other milestone in this file follows. Recorded
retroactively from the commit history rather than left undocumented.
docs/04_ROADMAP.md still has no milestone entry for this phase; that
gap is unaddressed.

---

## 2026-08-21 — Capstone pass: the 22-stage pipeline traced end to end, four broken handoffs fixed, one permanent test that walks the whole chain

**Decision:** A final correctness pass over the complete pipeline —
every stage from "lead entered by hand" to "project marked maintained"
— walked continuously rather than module by module, judging each
handoff against one rule: *automate the repetitive work, keep human
control over important decisions.* No new capability was added. Four
genuine defects were found and fixed, all of the same family: something
that should have carried forward, or been surfaced, silently didn't.

1. **Winning a lead left no trace on the lead's own history**
   (`modules/clients/service.py`). Converting a lead to a client set
   `Lead.status = WON` and recorded a `pipeline_event`, but no
   `activity_log` row — every other status transition in the system
   (`mark_researched`, `mark_contacted`, `mark_replied`, the meeting
   bump, the manual PATCH) records both. So the single most important
   event in a lead's life was invisible on the lead's history feed,
   showing only as "client created" and "project created" on two other
   entities. The 2026-08-20 entry below already described this call site
   as recording an activity row alongside the pipeline event; it didn't.
   Now it does.

2. **Re-opening intake wrote into an already-approved brief**
   (`modules/design_briefs/service.py`). Pass 4's idempotent
   `start_intake` gap-fills the brief from the client record on every
   re-run, and the Clients page's "Open intake" button sends real fields
   (business name, location, contact email/phone). On an *approved*
   brief that quietly changed the signed-off content — with no history
   entry and no revert — while `update_brief` right below it reverts an
   approved brief to draft for exactly this reason. The approved brief
   is what the creative direction, sitemap, and website generator all
   read from, so this was the same stale-approval bypass the 2026-08-21
   QA review fixed for website sections. The gap-fill now skips an
   approved brief entirely (changing one is the explicit PATCH, not a
   side effect of navigation), and a gap-fill that *does* change a draft
   now records `brief_updated`.

3. **A call-to-action button that goes nowhere**
   (`agents/website_generator.py`). Every CTA the generator builds
   points at the contact page; with no contact page in the sitemap it
   fell back to a hardcoded `"#contact"` anchor that no generated page
   defines. `agents/technical_qa.py` can't catch it — its internal-link
   check skips `#` fragments by design — and nothing appeared in
   `missing_information`, so a dead button could ship through every
   approval gate unremarked. Same class as the nav-logo `"/"` bug fixed
   on 2026-08-21, and found by auditing the rest of the generator for
   it. With nowhere honest to point, the CTA is now simply not built and
   the gap is reported once in `missing_information` — the module's own
   stated rule for content it has no source for.

4. **Regenerating one section cleared the "needs review" flag**
   (`modules/websites/service.py`). The new version carries the previous
   one's `missing_information` forward and `get_website` goes on
   displaying it, but `flagged_for_review` was recomputed from the
   Anti-Slop verdict alone — so regenerating any section dropped the
   badge on a site that still had unfilled gaps.

**Also verified, unchanged:** the meeting brief still degrades correctly
now that every generator raises `LlmUnavailableError` — `_generate_brief`
catches broad `Exception`, and `LlmUnavailableError` is a `RuntimeError`,
so a missing key, a configured-but-failing key, and a working key were
each exercised and each behave as designed (facts always assembled, only
the discovery half degrades). A sales-audit LLM failure leaves zero
partial rows despite stages 2-5 sharing one transaction. Each of the six
prerequisite checkpoints refuses deployment by name. Anti-Slop catches a
hand-edited fabricated testimonial and an unverifiable superlative, and
its score is on the same payload the operator approves from. The SSRF
guard covers both browser entry points, which are the only two.

**A new permanent test, `tests/test_end_to_end_workflow.py::
test_all_22_stages_with_invariants`,** replaces the previous partial
walk. It is deliberately one long test rather than several: a handoff
that breaks in the middle only shows up when the chain is walked
continuously, with each stage's real output as the next stage's input.
Alongside the stage walk it asserts the four standing invariants (no
false success, no fabricated content, no unapproved deployment, an
auditable history) — including a named-transition check on the activity
log, which is what makes defect 1 above fail loudly if it returns.

**Why:** this is the last pass before the tool is trusted with real
client work. Every finding here is a case where a human was nominally in
control but not actually informed — an approval covering content that
had since changed, a dead button nobody was told about, a "reviewed"
badge that cleared itself, a won deal with no record on the lead. None
of them break a test or throw an error; they just quietly degrade the
operator's picture of what's true, which is the failure mode this system
can least afford.

**Alternatives considered:**

- *Applying the intake gap-fill and reverting the approval to draft*,
  mirroring `update_brief`. Rejected: clicking a navigation button
  ("Open intake") would silently un-approve a signed-off brief, which is
  a worse surprise than not pre-filling. Not writing at all keeps
  content and sign-off in sync with no side effect either way.
- *Keeping the `"#contact"` CTA and only reporting it.* Rejected — the
  gap report is the point, but shipping a button that does nothing when
  clicked isn't made acceptable by mentioning it in a list elsewhere.
- *Building maintenance monitoring* (uptime, broken links) to fill
  stage 22. Explicitly out of scope: [[04_ROADMAP]] M6 already lists it
  as not built, and the brief for this pass was correctness, not new
  capability.

**Known limitations confirmed, not fixed:** Anti-Slop is a
deterministic pattern matcher, so a plausible-sounding invented claim
with no trigger word or number ("family owned since 1952") passes — the
real guarantee against fabrication is structural (the generator only
copies brief fields; it never drafts prose), and Anti-Slop is the second
net over hand edits, not the first. `agents/anti_slop.py` also only
inspects page sections, not the navigation/footer configs. Neither is a
regression; both are the documented shape of the design.

---

## 2026-08-21 — Daily-use pass: the Overview answers "what do I do next", outreach keeps its own lead status, "Start intake" stops duplicating projects, launch gets a checklist, Projects/Clients get search

**Decision:** Five changes aimed squarely at operator time-per-day, not
feature coverage. Ranked and picked by (frequency × time saved) ÷
effort, for a two-person shop using this every working day.

1. **The Overview now answers "what should I do next?"**
   (`modules/dashboard/`). The "Needs your attention" list previously
   covered exactly two signals — due/undated tasks and leads stale 5+
   days — which meant the entire delivery half of the business, and the
   whole `FollowUp` module, were invisible from the screen an operator
   opens first. It now aggregates five kinds of open loop: overdue and
   due-today **follow-ups**, **meetings** starting within 48 hours,
   **tasks**, **stale leads**, and — new — the single most useful next
   action for every unfinished **project**.

   Each row carries an `action` (the imperative next step, e.g.
   "Review the QA report and sign it off") and an `href` to the exact
   screen where it's done, rather than a bare section index; stale-lead
   rows now deep-link to the lead instead of the leads list, and their
   suggested action varies with how far the lead actually got. The list
   is ranked server-side and rendered in the order received: a broken
   deployment first, then overdue follow-ups, imminent meetings,
   blocked project gates, overdue tasks, follow-ups due today,
   upcoming tasks, stale leads.

   The per-project row is a "first unmet gate" waterfall over the same
   checkpoint sequence `modules/approvals/service.py` reports for a
   single project (brief → creative direction → sitemap → website → QA →
   client review → deploy), with a failed deployment short-circuiting
   ahead of everything. Deliberately **one row per project**, never
   seven, so the list stays a to-do list rather than a status dump; a
   project with every approval in and a successful deployment drops off
   entirely. It's a batched implementation (Postgres `DISTINCT ON`, one
   query per entity type for all projects at once) rather than N calls
   into the approvals service — `approvals/service.py` remains the
   authority on a single project's full checkpoint detail, and the two
   must be kept in step if a checkpoint is ever added or reordered.

   Two metric tiles changed. `meetings` — a count of *every* meeting
   ever booked, a number that only went up and that nobody could act on
   — became **`upcoming_meetings`** (still scheduled, in the future).
   **`follow_ups_due`** was added, since follow-ups had no presence on
   the dashboard at all. `AttentionItem` gained `label` and `action`;
   the frontend's hardcoded "Task"/"Stale lead" ternary is gone.

2. **Marking outreach sent/replied now moves the lead's status**
   (`modules/outreach/service.py` → new `mark_contacted`/`mark_replied`
   in `modules/leads/service.py`). Previously both recorded an
   `Interaction` and touched nothing on the `Lead`, so `CONTACTED` and
   `REPLIED` were unreachable except by hand-flipping a dropdown — an
   extra edit after every single send, and one that gets forgotten,
   which then corrupts the funnel counts *and* the stale-lead detector
   that keys off `updated_at`. Forward-only, same contract as
   `mark_researched` and `meetings/service.py`'s
   `_PRE_MEETING_STATUSES`: a lead already at meeting/proposal/won/lost
   isn't dragged backwards, and a `NURTURE` lead stays parked
   (`NURTURE` is a deliberate side state, not a pipeline position).

   This automates *bookkeeping only*. The operator still does the
   sending, and still clicks "Mark sent" — no outreach is ever
   dispatched by the system (docs/03_AGENT_RULES.md). The prior
   `test_end_to_end_workflow.py` assertion that outreach *doesn't*
   advance status was codifying the gap, and was updated.

3. **"Start intake" is idempotent** (`modules/design_briefs/service.py`).
   It created a brand new `Project` on every click, with no guard and no
   delete route — so a double-click, or clicking it for a client who
   already had a live project, silently produced permanent duplicates.
   It now reuses the client's existing unfinished project (anything not
   at `MAINTENANCE`/`COMPLETE`) and returns that project's brief,
   filling only the brief fields that are still empty so a re-run never
   clobbers an operator's own answers. A genuinely additional project
   for a repeat client is the explicit `force_new` opt-in, surfaced as a
   confirm-gated "Start another project" secondary action that only
   appears when a live project exists; the primary button reads "Open
   intake" instead of "Start intake" in that case. Intake now also seeds
   `DEFAULT_INTAKE_TASK_TITLES`, which only the lead-conversion path did
   before — the two ways of creating a project were inconsistent.

4. **A successful first deploy seeds a launch/handover checklist**
   (`DEFAULT_LAUNCH_TASK_TITLES` in `modules/projects/service.py`).
   `DEFAULT_INTAKE_TASK_TITLES` was the only stage transition seeding a
   checklist; launch is the other point where a pile of easily-forgotten
   manual admin follows (hand over logins, set up analytics, send the
   live URL, invoice, ask for a testimonial) — including the two that
   directly cost money if skipped. `advance_stage()` now returns whether
   the stage actually moved, so the seed hangs off the real transition
   and a redeploy or rollback can't duplicate it.

5. **Search and filtering on Projects and Clients.** Leads already had
   search + status/priority/assignee filters + sortable columns;
   Projects and Clients had none. Both now have text search (project
   name/client/package; business name/billing email) and an assignee
   filter incl. "Unassigned"; Projects also has a stage filter and hides
   `maintenance`/`complete` by default so finished work stops burying
   live work. The predicates live in `apps/web/src/lib/filters.ts` as
   pure functions so they're unit-testable without a DOM — the existing
   Vitest setup has no jsdom, and adding one for this wasn't warranted.

**Why:** The operators' stated priority is revenue per human-hour. Every
item above removes a repeated manual action (a second status edit after
every send), a repeated decision ("what should I be doing?"), or a
cleanup cost (duplicate projects that can't be deleted). Nothing here
adds a new capability — it removes friction from capabilities that
already existed but were either invisible (follow-ups, delivery gates)
or required redundant bookkeeping.

**Alternatives considered:**

- *Per-project rows for every unmet checkpoint* instead of just the
  first. Rejected: seven rows for one project turns a to-do list into a
  status report, and only the first is actionable anyway.
- *Calling `approvals.get_project_approval_status` per project* rather
  than batching. Rejected on query count (7 × N); the batched version is
  a fixed ~7 queries regardless of project count. The duplication is
  accepted and flagged in both files, matching the tolerance already
  documented in `approvals/service.py` for its own "latest row" resolvers.
- *An "unassigned lead" attention row.* Rejected: with two operators,
  an unassigned lead isn't blocked — it's just unlabelled — and every
  newly added lead would flood the list.
- *A nav badge counting due follow-ups.* Rejected: it costs a fetch on
  every page to duplicate what the Overview already says.
- *409-ing a repeat "Start intake"* instead of reusing the project.
  Rejected: an error page is worse for the operator than just landing
  them on the intake they already started.
- *Keyboard shortcuts.* The brief ranked these lowest, and nothing in
  these flows is repetitive enough per-session to earn the muscle
  memory. Skipped rather than forced.

**Not done, deliberately:** rate limiting on the expensive generation
routes and the near-total absence of responsive CSS both remain open
from the 2026-08-20 QA review — neither is an operator-time problem, and
both want their own pass.

---

## 2026-08-20 — Real deployment system (roadmap M6); `Project.stage` and `Lead.status` now advance automatically through the pipeline; `pipeline_events` finally gets writers

**Decision:** Three pieces of work, done together because the third
depends on the first two actually existing:

1. **Deployment system** (`modules/deployments/`). Previously a stub —
   `POST .../deployments` created a `status="pending"` row and nothing
   ever changed it. Now: `integrations/deployment.py` defines a
   `DeploymentProvider` interface (`deploy(bundle) -> DeploymentOutcome`)
   with one implementation, `MockDeploymentProvider` — no real hosting
   account is configured, so this is the only provider that exists, and
   it never makes a network call or claims a real publish (every result
   carries `target="mock"` and an obviously-fake `.mock-deploy.internal`
   URL). `settings.deploy_provider` is the real extension point for a
   future host; pointing it at anything but `"mock"` raises rather than
   silently no-opping. `Deployment` gained `target`, `result` (JSON),
   `error_message`, `started_at`/`completed_at`, and
   `rollback_of_deployment_id` (migration `0b9dfd5a2170`). The lifecycle
   is now prepare (`POST .../deployments`, unchanged approval gate, plus
   new `modules/deployments/checks.py` — required assets/config exist, no
   secret-shaped content in the generated site's JSON, a domain on file
   where a *real* target would need one, the specific QA report's own
   critical-issue count) → execute (`POST .../deployments/{id}/execute`,
   `pending`/`failed` only, lands on `success`/`failed`) → rollback
   (`POST .../deployments/rollback`, re-runs a prior *successful*
   deployment of an older website version after re-verifying that
   version's own approval/QA/client-review flags, not the project's
   current ones). The domain check only blocks for a non-mock provider —
   existing tests deploy without a domain configured, and the mock
   never publishes anywhere a real domain would matter; the check and
   its own unit tests exist regardless, so flipping it on for a real
   provider is a one-line change.
2. **`Project.stage` and `Lead.status` now move forward automatically.**
   Before this, only two transitions existed anywhere in the codebase:
   client conversion set a new project to `INTAKE`, and brief approval
   bumped `INTAKE -> BRIEF` — every later stage (`DESIGN` through
   `COMPLETE`) was dead, and `LeadStatus.RESEARCHED` was never set by
   anything despite existing. `modules/projects/service.py` gained
   `advance_stage()` — forward-only (never regresses a stage that's
   already further along), used by every downstream approval/generation
   action: creative direction approval and sitemap approval -> `DESIGN`;
   website generation -> `DEVELOPMENT`; website approval -> `QA`; QA
   approval -> `CLIENT_REVIEW`; client review -> `READY_TO_DEPLOY`;
   successful deployment execution -> `DEPLOYED`. `modules/leads/service.py`
   gained the same "forward only" `mark_researched()`, called from
   `sales_audits.generate_sales_audit` right after the website audit
   runs, mirroring `meetings/service.py`'s existing `_PRE_MEETING_STATUSES`
   pattern for the `MEETING` bump. `REVISIONS`/`MAINTENANCE`/`COMPLETE`
   stay operator-only (`ProjectUpdate`'s existing manual PATCH) — nothing
   automatically produces "client asked for changes" or "project is
   done."
3. **`pipeline_events` gets writers.** This table (`modules/pipeline/`)
   existed since the multi-user migration with a docstring describing
   exactly this purpose ("stage-transition history for a lead or
   project," deliberately not the polymorphic `activity_log`) but
   nothing ever inserted into it. `modules/pipeline/service.py` now has
   `record_project_event`/`record_lead_event`, called everywhere
   `Project.stage` or `Lead.status` actually changes — inside
   `advance_stage`/`mark_researched` for the automatic paths, and
   alongside the existing `activity_log` calls for the manual ones
   (`ProjectUpdate`'s stage PATCH, `LeadUpdate`'s status PATCH, client
   conversion's `-> WON`, meeting booking's `-> MEETING`). It still has
   no routes — `activity_log` remains the user-facing history feed (it
   already logs `stage_changed`/`status_changed`); this is the backend-
   only stage-transition record the table was always meant to be.

**Why:** requested directly — "the human approval workflow," "the
website deployment system," and "connect the complete Web Design OS
workflow end-to-end," in that order, auditing the existing
implementation before changing it. The approval-workflow half of (1)
was already essentially complete (all seven checkpoints, versioned
re-approval, deployment gating, frontend `ApprovalPipelineView` — see
roadmap M5's entry) and needed no changes; only the actual publish
action was a stub. `Project.stage`'s dead middle was found by grepping
every `ProjectStage.` reference in `app/modules` and seeing brief
approval was the *only* write past the default — the pipeline view
existed but nothing fed it past the second stage.

**Alternatives considered:** Making the deployment `checks.py` domain
check unconditionally blocking — rejected; it would 400 the existing
happy-path deployment test (which never sets a domain) for a
requirement that only has teeth once a real host exists to care where
it's published. A generic "advance to any explicitly-requested stage"
helper callable from routes — rejected in favor of hardcoding each
call site's target stage next to the action that earns it (creative
direction approval always means `DESIGN`, never a caller-supplied
value), since the pipeline's stage meanings are fixed by the operator's
12-stage spec, not something a caller should get to override per call.

---

## 2026-08-19 — Client intake + Creative Director merged same day: Creative Director now defaults target audience/goals from the intake brief

**Decision:** These two M4 features were built concurrently on separate
branches (see both entries below) and merged the same day. On merge,
`modules/creative_directions/service.py`'s `generate_creative_direction`
was updated to close the seam the Creative Director entry below
describes: it now looks up the project's `DesignBrief` (client intake,
see the entry below) and uses `target_customers`/`business_goals` as
the default `target_audience`/`business_goals` for the agent when the
generation request doesn't explicitly override them, and folds
`business_description`, `services_products`, `brand_colours`,
`brand_fonts`, `brand_guidelines`, and `visual_references` into the
agent's input as confirmed client context when present. A project with
no intake brief yet (or one still missing those fields) falls back to
the pre-merge behavior: operator-entered text at generation time, gap
flagged for review.

**Why:** the Creative Director entry below was written to not block on
client intake landing, explicitly leaving this as the one integration
point to revisit once it did — see its "when intake lands" note. Intake
landed the same day, so closing it immediately avoids leaving known-
stale guidance in the docs below it.

---

## 2026-08-19 — Creative Director: separate module from `design_briefs`, target audience/goals stay operator-entered until client intake lands

**Decision:** Built the Creative Director role (roadmap M4) as a new
`modules/creative_directions/` module (`creative_direction_briefs`
table) rather than filling in the existing `design_briefs` stub
(`goals`/`tone`/`pages` — never wired to a route). The feature asks for
13 distinct creative-direction fields (concept, visual direction, brand
personality, colour, typography, image, layout, UX direction, tone of
voice, visual hierarchy, CTA strategy, things to avoid, references) plus
an explicit FACTS/ASSUMPTIONS split — materially richer than the stub,
and a different concern from a plain brief.

Generated via `agents/creative_director.py`, one row per generation,
editable in place (`edited_by/at`) and gated behind an explicit
DRAFT → APPROVED status (mirrors `OutreachStatus`) before a designer or
the site-generation system should treat it as final — the "review and
edit before continuing" requirement. `POST /projects/{id}/creative-
directions` (rate-limited, like Sales Audit/Outreach/Follow-up),
`PATCH /creative-directions/{id}` to edit, `POST .../approve` to gate.

Client intake (`04_ROADMAP.md` M4, not yet built) is the eventual
source of two inputs the direction most depends on for being
client-specific rather than generic: target audience and business
goals. Until it exists, `GenerateCreativeDirectionRequest` takes them as
plain operator-entered text at generation time. The agent treats their
absence as a hard signal, not a soft one: `flagged_for_review=True` and
an explicit assumptions-only path, never a silently generic direction.
When intake lands, `modules/creative_directions/service.py` is the only
place that needs to change — pull the two fields from the intake record
instead of the request body; the agent, schema, and stored shape don't
change.

Research grounding: `generate_creative_direction` walks
project → client → business → (business's) lead → latest `WebsiteAudit`
+ latest `SalesAuditReport`, i.e. it reuses whatever real evidence the
sales process already gathered rather than re-auditing. A project whose
client was added directly (never went through a lead) has no such
history — genuinely thin evidence, also flagged.

**Why:** `docs/03_AGENT_RULES.md` requires flagging rather than passing
a low-confidence result through silently, and the feature's own spec
requires never presenting an assumption as a fact — a single explicit
gap-detection path (missing target audience *and* goals) is simpler and
more legible than trying to infer confidence from a dozen loosely
related signals.

**Alternatives considered:** Waiting for client intake to be built
first was considered (two other in-flight branches — Calendar/Client
Management and the meeting-prep system — were mid-flight against
`projects`/`clients` at the same time) and rejected: the FACTS/
ASSUMPTIONS/RECOMMENDATIONS split the feature explicitly asked for is
exactly the mechanism for handling incomplete intake gracefully, so
blocking on intake would have meant not using the framework that exists
to avoid that dependency. `projects/models.py`, `clients/schemas.py`,
and `clients/service.py` were left untouched by this change for the
same reason — the new table's `project` relationship is deliberately
one-directional (no `back_populates` on `Project`) so this module stays
purely additive against files other concurrent work was touching.

---

## 2026-08-19 — Client intake system: one wide `design_briefs` row per project, missing fields computed not stored

**Decision:** Built the M4 "Client intake form → auto-creates a project
record" item by expanding the `design_briefs` stub (`goals`/`tone`/
`pages`) into the full BUSINESS/BRAND/CONTENT/WEBSITE/ASSETS intake the
operator specified — 35 fields total, every one nullable, list-shaped
ones (colours, testimonials, required pages, ...) stored newline-
separated in `Text` columns, same convention as `businesses.
social_links` and the Sales Audit report sections — no JSON columns.
`design_briefs.project_id` is now unique: one brief is the project's
single evolving source of truth, not a history of generations.

`BriefRead.missing_fields` is computed on every read from whatever's
currently null/empty, never stored — the "clearly identify missing
information, never fabricate it" requirement is structural (a field
either has a real value or it doesn't) rather than a flag that could
drift out of sync with the data. `POST /api/v1/clients/{id}/intake`
creates the project (`INTAKE` stage) and brief together in one call,
pre-filled from whatever the operator already entered; `GET`/`PATCH
/api/v1/projects/{id}/brief` lazily create an empty draft on first
touch instead of requiring a separate create step for projects that
already existed. Editing an `APPROVED` brief reverts it to `DRAFT`
(clearing the approval) so the "approved" label can never describe
content that's since changed; approving a brief advances the project
past `INTAKE` to `DESIGN_BRIEF` if it hasn't moved already.

Assets (logos, images, videos, documents, existing copy) are captured
as reference/notes lines (e.g. a Drive link plus a label), not actual
file uploads — there's no blob storage integration anywhere in this app
yet (see [[02_ARCHITECTURE]] `integrations/`), and building one wasn't
part of this task. Revisit if/when a real upload flow is needed for
site generation in M5.

**Why:** A single wide table mirrors the existing `sales_audit_reports`/
`meeting_briefs` pattern (one row, many `Text` sections) rather than
introducing a new normalized shape or JSON columns for a form that's
edited field-by-field, not generated wholesale by an agent. Computing
"missing" instead of storing it removes an entire class of staleness
bug. Reverting approval on edit was chosen over either silently
allowing drift or hard-blocking edits after approval — the operator
should always be able to fix a brief, but the "approved, ready for
design" label has to mean what it says.

**Alternatives considered:** A separate `client_intake` table feeding a
generated `design_briefs` row — rejected; there's no meaningful
distinction between "what the client told us" and "the brief" at this
stage (no AI drafting/summarization step yet, per M4's still-open
"Design brief ... generated from intake + research" item), so a second
table would just be the same 35 fields duplicated. Blocking approval
until every field is filled — rejected; the operator may knowingly
proceed with real gaps (e.g. "logo TBD, client sending later"), and the
job here is to surface that, not to gate on it.

---

## 2026-08-20 — Human approval workflow: seven checkpoints, no schema-level fabrication, deployment gate re-verifies current state

**Decision:** Built `modules/approvals/` plus new approval fields/
actions on `Website`, `QaReport`, and `Deployment` for the seven
checkpoints the operator specified: client brief, creative direction,
sitemap, generated website, QA, client review, final deployment. Three
of these (brief, creative direction, sitemap) already had `status`/
`approved_by_user_id`/`approved_at` columns from earlier work — no
schema change there, just two real gaps found and closed:

- **`CreativeDirectionBrief.status` never reverted to `DRAFT` on edit**
  — `update_creative_direction` updated `edited_at`/`edited_by_user_id`
  but left an already-`APPROVED` row `APPROVED` after a content change,
  unlike `DesignBrief`'s existing (correct) behavior. Fixed to match.
- **`Sitemap.status` never reverted either** — none of `add_page`/
  `update_page`/`delete_page`/`reorder_pages` touched `status`, so an
  approved sitemap silently stayed "approved" through structural edits.
  Fixed via a shared `_revert_approval` helper called from all four.

Both fixes are exactly "if the underlying content changes
substantially, require approval again" — a requirement that turned out
to already be a real, if partial, contract in this codebase (via
`DesignBrief`), just inconsistently applied.

**The four new checkpoints, and why they live where they do:**

- **Generated website** (`Website.approved`) — the operator's own
  content/design sign-off. Distinct from a section's own `approved`
  flag inside `config` (roadmap M5's earlier "regenerate a section
  without destroying approved ones" feature) — that's fine-grained
  content review; this is the whole-version gate later checkpoints
  require. Editing a section's *content* (not just toggling its own
  `approved` flag) on an already-approved version reverts `approved`
  (and `client_approved`) back to `False` — same "edit reverts
  approval" contract as the three pre-existing checkpoints.
- **QA** (`QaReport.human_approved`) — a human sign-off distinct from
  the report's own automated `passed` verdict (`ready_for_client_review`
  from the Anti-Slop/QA work). `approve_qa_report` refuses outright when
  `passed` is `False` — a critical issue can't be rubber-stamped past,
  which is "a website should not be considered ready for client review
  until critical QA issues are resolved" enforced at the data layer, not
  just documented as a rule.
- **Client review** (`Website.client_approved_by_user_id`, etc.) —
  there's no client login anywhere in this app (see
  [[03_AGENT_RULES]]'s "Client approval communication" note: relaying
  feedback is fine to draft, the client doesn't have their own
  account), so this is an *operator* recording that the client approved
  — by email, call, whatever channel — not the client's own action.
  Lives on `Website` alongside checkpoint 4 rather than a separate
  table, since both are fundamentally "is this version okay to proceed"
  checks on the same underlying artifact, just from different
  reviewers.
- **Final deployment** (`modules/deployments/`, previously just a bare
  `Deployment` model with no service or routes at all) — creating a row
  *is* the approval record for this checkpoint. `create_deployment`
  refuses unless `modules/approvals/service.py` reports every one of
  the other six checkpoints currently approved, re-checked fresh at
  deployment time rather than trusted from an earlier gate — a real
  edge case this catches: the brief could be edited (reverting its own
  approval) *after* the website/QA/client-review were all approved, and
  a deployment attempted after that must still be blocked even though
  nothing about the deployment gate itself changed. No real hosting/
  publish action happens — `status` stays `"pending"`, per "do not add
  automatic deployment yet" (still holding from the website-generation
  and QA passes).

**The aggregation service** (`get_project_approval_status`) is a plain
query function, not a new generic "Approval" table — every checkpoint's
real state already lives on its own natural row (`DesignBrief`/
`CreativeDirectionBrief`/`Sitemap`/`Website`/`QaReport`/`Deployment`),
matching this repo's established preference for narrow, purpose-built
columns over a shared polymorphic table (see the activity_log entries
below — this is the same call made again, for the same reason).
`can_deploy` is computed by checking all six prerequisite checkpoints'
*current* independent state rather than trusting that the last one
approved (client review) implies the rest still hold — deliberately not
relying on the sequential gating each individual approve-action already
enforces, for the same "brief edited after the fact" reason the
deployment gate re-checks fresh. Each checkpoint's own approval only
reverts on edits to *that* entity — there's no cross-entity cascading
invalidation (editing the brief doesn't retroactively un-approve a
sitemap that was generated from it). That's a deliberate, narrower
scope: the operator-specified requirement is about each stage's own
versioned content, and a full reactive dependency-invalidation graph
across all six is a materially bigger feature nothing in the request
asked for.

**Frontend:** an `ApprovalPipelineView` on the main project page — the
single place all seven checkpoints are visible at a glance, each
showing why it's blocked when it is — plus a `Deploy` button gated on
`can_deploy` with the missing stages listed in its tooltip when
disabled. Approve/client-approve/approve-QA actions live on the
existing website page next to the content they're approving, not on
the pipeline view itself (which stays read-only status, not an action
surface). Verified end to end in a real browser through the entire
sequence — brief → creative direction → sitemap → website → QA →
client review → deployment — confirming each checkpoint only flips
`true` once its own action succeeds and the `Deploy` button is
genuinely disabled until all six are green.

**Why:** "the system must never automatically publish a client website
without human approval" needed to be a hard, checkable gate, not
scattered `status` fields nobody was required to check before acting —
this is that gate made explicit and centrally queryable.

**Alternatives considered:** a generic polymorphic `Approval` table
(`entity_type`/`entity_id`/`approved_by`/`approved_at`) — rejected for
the same reason `activity_log` was originally rejected as a global
table (see the 2026-08-16 multi-user entry below) and only narrowly
reversed for one specific need: three of the seven checkpoints already
had purpose-built columns, and forcing those into a generic shape would
mean either migrating working columns for no functional gain or running
two parallel approval representations side by side.

---

## 2026-08-20 — Technical QA: static checks always run, live-preview checks reported as skipped (not hidden) until deployment exists

**Decision:** Built `agents/technical_qa.py` + `modules/qa_reports/`
(roadmap M5's "Automated QA checks"). Every check falls into one of two
modes:

- **Static** — inspects the generated config directly, always runs.
  Real, fully-mechanical wins: broken-internal-link detection (every
  `href` found anywhere in a section's config, walked the same way
  `agents/anti_slop.py` walks for media, checked against the site's own
  page slugs — external/mailto/tel/anchor links are never flagged,
  since only internal routing can be verified without fetching
  anything); missing alt text and unlabeled form fields (both
  accessibility-critical, both fully knowable from the config); more
  than one `hero` section on a page (a duplicate `<h1>`, since Hero is
  the only section that renders one); exposed-secret and injected-
  script/`javascript:` scanning across every string in the config. A
  few checks (keyboard accessibility, semantic HTML, no unsafe client-
  side rendering) are reported `pass` "verified by construction" — true
  because `packages/site-templates` only ever renders native
  interactive elements and never raw/unescaped HTML, not because
  anything was tested live; the message says so explicitly rather than
  implying a real interaction test happened.
- **Live** — needs a rendered page (real asset weight, computed colour
  contrast, console errors, cross-viewport overflow, robots.txt/
  sitemap.xml reachability), so only runs given a `preview_url`. A new
  `fetch_qa_signals` in `integrations/browser.py` reuses
  `fetch_page_signals`'s SSRF guard (checked before the browser even
  launches) and adds: overflow checks at desktop/tablet/mobile
  viewports, a real WCAG relative-luminance contrast sample over a
  page's visible text elements, console-error capture, an actual fetch
  of every other internal page, and summed `content-length` for total
  page weight.

**"Do not automatically hide failures" applies to what can't be
checked yet, not just to what fails**: every live-only check still
appears in the report with `status: "skipped"` and an explanation when
there's no `preview_url` — nothing is silently absent. This mattered
enough to need a real bug fix mid-build: three static-check functions
(`Colour contrast`, `Console errors`, `Served over HTTPS`) originally
appended their own "skipped" placeholder *unconditionally*, so once a
`preview_url` was supplied both the placeholder and the live check's
real pass/fail result ended up in the same report under the same name
— duplicate, contradictory entries for the same check. Fixed by only
adding the static placeholder when there's no `preview_url` to run the
live version instead.

Since there's no build/hosting step yet (roadmap M6), `preview_url` is
always `None` in practice today — canonical URLs, Open Graph images,
and robots.txt/sitemap.xml are reported `skipped`/"not applicable
before deployment" rather than failed, per the operator's own "where
appropriate"/"where testable" phrasing for exactly these checks.

**A real gap found and closed while building this**: neither the
sitemap nor the generator captured a per-page `<title>`/meta
description anywhere, so there was nothing honest for the new "Page
titles"/"Meta descriptions" checks to inspect. Extended
`agents/website_generator.py`'s `GeneratedPage` with a `seo` field —
`title` mechanically composed from real fields only (`business_name`
for Home, `"{page.title} | {business_name}"` elsewhere — navigational
metadata, not a business claim, so composing/truncating it carries none
of the fabrication risk a body-copy claim would), `meta_description`
left `null` (never invented) when there's no real description to
summarize, truncated on a word boundary when there is one. Missing
descriptions now show up in `missing_information` the same way every
other real gap does.

**`ready_for_client_review` is false whenever any check both failed
and is `critical` severity** — matches "a website should not be
considered ready for client review until critical QA issues are
resolved" verbatim; warnings and skips never block it on their own.
One `QaReport` row per run, not overwritten, same versioning convention
as `Website`/`Sitemap`/`CreativeDirectionBrief` — a website version can
be re-checked after an edit without losing the history of prior runs.

**Testing**: static checks and the pure signal→check mapping functions
(`_responsiveness_checks_from_signals` etc. — these take a constructed
`QaPageSignals`, not a URL, so they're genuinely real Python-level
tests, no mocking needed) are covered by 47 pytest tests. `browser.py`'s
actual Playwright driver is verified the same way `fetch_page_signals`
already was (see `tests/test_website_audit_ssrf.py`): the SSRF-
rejection contract is a real pytest test, but real page rendering isn't
— its own SSRF guard blocks `localhost`, so a permanent pytest test
would need to bypass a security control just to run. Instead it was
verified manually, for real: a deliberately broken local static HTML
fixture (a 2000px-wide div, `console.error("intentional test error")`,
`#eee`-on-white text, a link to a genuinely 404'ing page) served via
`python -m http.server`, audited with the SSRF check monkeypatched off
for that one throwaway call. Every signal came back correct — overflow
`True` at all three viewports, the exact console message, the exact
broken path (and *not* a false positive on the real `/about` page,
which 301-redirects before 200ing), a contrast ratio of ~1.16:1 (genuinely
below the 4.5:1 WCAG AA floor), and the real transferred byte count.

**Why:** [[01_REQUIREMENTS]]'s quality floor and the operator's own "a
website should not be considered ready for client review until critical
QA issues are resolved" needed the same treatment Anti-Slop gave content
quality — explicit, checkable rules instead of a hope that the generator
got everything right.

**Alternatives considered:** gating every check on a live preview (i.e.
doing nothing pre-deployment) — rejected; most of what actually matters
today (broken links, missing alt text, unlabeled forms, exposed
secrets) is fully knowable from the config alone, and waiting for M6 to
report any of it would leave real, fixable problems unreported for
months. An LLM-judged QA pass — rejected for the same reason
`agents/lead_score.py`/`agents/anti_slop.py` are deterministic: "ready
for client review" needs a floor that can't drift between runs.

---

## 2026-08-20 — Website generation: deterministic assembly, per-section versioning, no live preview yet

**Decision:** Built `agents/website_generator.py` + `modules/websites/`
(roadmap M5's "site generation from brief + sitemap + copy + client
assets"). Given a project's approved (or latest) `Sitemap`, `DesignBrief`,
and `CreativeDirectionBrief`, it assembles one `packages/site-templates`
section list per sitemap page plus a shared navigation/footer, using
only fields that already exist on those rows — never a paraphrase, never
an invented fact. Concretely: a `services_content` blob only becomes a
`serviceCards` grid when it's actually shaped like a short list (2-8
lines under 120 chars each — `_looks_like_list`); otherwise it becomes a
Hero subheading, since forcing unstructured prose into card titles would
invent structure that isn't there. Sections this system has no honest
source for yet — pricing, team, portfolio, stock imagery with real alt
text, stats — are never built at all; the sitemap's `key_sections` hints
requesting them are turned into `missing_information` entries instead.
Every generation is run through `agents/anti_slop.py` before being
returned, so a caller never has to remember to check separately.

**Deterministic, not LLM-drafted** — unlike `agents/sitemap.py` and
`agents/creative_director.py`. This step only ever copies or lightly
reshapes fields that already exist rather than drafting new prose, so an
LLM call would add nothing but a new fabrication surface (a paraphrase
is still an invention) and a flakiness/cost source for zero benefit.

**Versioning:** `Website` already allowed multiple rows per project (no
unique constraint), so "store generated versions so previous versions
can be reviewed" needed no new versioning mechanism — just generation
metadata (`generated_by_user_id`/`generated_at`,
migration `bf7f04e11e67`). Each section within the stored `config` JSON
carries its own `id` and `approved` flag. A full regeneration carries
forward every already-approved section by default, matched back into
the fresh output by `(page slug, section type)` since a fresh generation
always mints new ids — opt into `force_regenerate_all` to discard them
instead. A single section can be regenerated on its own: the whole site
is regenerated internally (the agent is stateless, so there's no cheaper
single-section path), the fresh replacement for that one `(page, type)`
slot is spliced into a copy of the current version, and everything else
— ids, approvals, edits — carries over untouched. If the sitemap/brief
changed enough that the fresh output no longer has a matching slot, the
regenerate 400s with an explicit "source data may have changed" message
rather than silently deleting the section. Approving a section or
hand-editing its `config` (shallow-merged, "editable output, not a
locked mockup") mutates the current version's JSON in place — no new
row — which surfaced a real SQLAlchemy gotcha worth remembering: mutating
a dict reachable from a JSON column, then reassigning the column to
`{**old}` to "trigger" change detection, doesn't work, because by that
point the "old" value SQLAlchemy compares against is the same
already-mutated object graph, so the values compare equal and the
UPDATE is silently skipped. `sqlalchemy.orm.attributes.flag_modified`
is the actual fix — it forces the UPDATE regardless of that equality
check.

**No LLM rate limiting on these routes** — unlike sitemap/creative-
direction/outreach generation, which sit behind
`enforce_generation_rate_limit`: this agent makes no paid API call, so
there's no budget to protect.

**Frontend:** a dedicated `/dashboard/projects/[id]/website` page
(not inlined into the main project page like brief/creative-direction/
sitemap — this needed materially more room per section) with a version
picker, quality-score/issues panel, missing-information panel, and one
card per section with Approve/Edit/Regenerate actions. Edit is a raw
JSON config textarea, not a live visual preview or a bespoke form per
section type — the dashboard doesn't depend on `packages/site-templates`
(no npm workspace wiring exists yet to import it, and 17 bespoke edit
forms was out of scope for this pass). Verified in a real Chrome browser
against a real local Postgres + FastAPI + Next.js stack, not just the 31
new backend tests — sitemap generation itself needs a real `LLM_API_KEY`
this environment doesn't have, so the sitemap fixture for that walkthrough
was seeded directly via the ORM (the same shape `agents/sitemap.py`
would have produced) rather than through its own generation endpoint;
website generation itself has no LLM dependency, so everything from
"Generate website" onward exercised the real code path end to end. That
pass caught a real bug no backend test could have: the frontend's
`onChange` handler updated the displayed website but never refreshed the
version-history dropdown, so a just-created version from a section
regenerate silently didn't appear in the list — fixed by refreshing the
version list alongside the website on every change.

**Why:** this is the first system in the app that turns already-collected
information into the actual deliverable, so the "never fabricate, flag
what's missing" contract established by Anti-Slop and the component
library's `validateSection` had to be load-bearing here, not aspirational
— see [[00_VISION]]'s "AI slop is unacceptable."

**Alternatives considered:** an LLM pass to smooth over/paraphrase brief
content into more natural section copy — rejected for the same reason
the agent itself is deterministic; a rephrase is still a fabrication risk
with no way to verify it stayed faithful to the source. A live
`packages/site-templates`-rendered preview in the dashboard — deferred,
not rejected; it needs an npm workspace (or equivalent) linking
`apps/web` to `packages/site-templates` that doesn't exist yet, and nothing about the JSON-editor approach blocks adding one later.

---

## 2026-08-19 — Anti-Slop quality evaluator: deterministic rules over section configs, missing content flagged instead of invented

**Decision:** Built `agents/anti_slop.py` as a deterministic rules
engine (no LLM call — same reasoning as `agents/lead_score.py`: a score
that can drift between runs of identical input isn't a score) that
takes a proposed site (`pages: [{name, sections: [{type, config}]}]`,
the same shape `packages/site-templates`' `SiteSection` configs take
and `websites.config` already stores as JSON) and returns a 0-100 score
plus a list of specific `QualityIssue`s. It operates on raw `dict`
configs rather than a Python port of the TypeScript types — a section's
prose fields, media, and card-shaped arrays are found by walking the
dict for known key names (`heading`/`body`/`quote`/etc., `{src, alt}`
pairs), which stays correct as sections gain fields without needing a
second schema kept in sync by hand (only the small `requiredFields` list
per type needs manual sync with `registry.ts`, called out in a comment
at the top of the map).

Every one of the operator's listed anti-patterns maps to a specific
rule: generic/cliche copy and "Welcome to our website" language against
a curated phrase list; repetitive AI phrasing via exact-duplicate
detection across every page's prose, not just within one page; generic
layouts and excessive cards via section-type-sequence checks (same type
stacked back-to-back, 4+ card-grid sections on one page, no hero/split
section to anchor the page); generic stock imagery via known stock-host
domains and generic-alt-text patterns; gradients/glassmorphism/rounded-
corners/animation via a `VisualStyleInput` the generator will report
(every field defaults to the safest value, so *omitting* it never
produces a false positive — only an explicit heavy-handed choice does).

The fabrication rules (fake testimonials, invented statistics, invented
claims) work by requiring a match against an `AuthenticContent` pool
(`known_testimonial_quotes`/`known_stat_values`/`known_claims`) the
generator is expected to supply from the brief/research/creative
direction — not by trying to guess truthfulness from text alone, which
isn't something pattern-matching can actually do. An empty pool doesn't
mean "assume it's all fine": every testimonial/stat/superlative claim in
the output gets flagged as unverified until something in the pool
backs it up. Two different match strictnesses are used deliberately —
testimonials/claims (full sentences) require both containment *and* a
0.6 length-ratio, so a three-word accidental substring can't validate a
fabricated quote; stat values (short tokens like `"12+"`, `"24/7"`) use
plain containment only, since the ratio guard would reject genuine
matches by construction.

Missing required content (`missing_information`) is reported completely
separately from `issues` and never affects `score` — conflating "this
page is honestly incomplete" with "this page is low-quality" would
punish exactly the behavior (flag a gap, don't invent filler) the whole
system exists to enforce. `passed` requires both `score >= 70` and zero
high-severity issues, so a site can't buy its way past one fabricated
testimonial by otherwise being clean.

Not yet wired into anything — no route, no call site. The generator
(roadmap M5, next) is expected to call it post-generation and react to
`flagged_for_review`, same contract as every other agent.

**Why:** [[00_VISION]]'s "AI slop is unacceptable — output quality is a
hard constraint, not a nice-to-have" and [[03_AGENT_RULES]]'s quality
bar were previously aspirational prose with nothing to check them
against. A generator that "tries to avoid slop" via prompt instructions
alone has no floor; this gives it one that's independently testable.

**Alternatives considered:** an LLM-as-judge quality scorer — rejected
for the same reason lead-scoring is deterministic: a judgment that can
flip between identical runs isn't a floor, it's a suggestion. Inferring
testimonial/statistic authenticity from text alone (tone, specificity
heuristics) — rejected as unfounded; nothing about *how a sentence
reads* proves whether it's true, so the only honest check is against a
supplied source of truth, not the text itself.

---

## 2026-08-19 — Component library: 17 sections on 8 shared primitives, config-driven, no fabricated content

**Decision:** Built `packages/site-templates` (roadmap M5's "first
template/component package") as a plain React/TypeScript package —
Tailwind utility classes only, no build tooling of its own, since
`apps/api` copies these files into a generated Next.js project at build
time rather than importing them as Python code (see
[[02_ARCHITECTURE]] §2). Every section (Navigation, Hero, CTA, Service
cards, Features, Testimonials, Pricing, FAQ, Contact, Image/content
split, Gallery, Footer, Form, Stats, Logos, Team, Portfolio) takes one
typed, JSON-serializable config object and renders exactly that — no
section fetches data, computes a number, or falls back to placeholder
copy. `Media.alt` is required (not optional) on every image type in the
config, and `Testimonials`/similar list sections render nothing rather
than a placeholder when their content array is empty.

Rather than a component per near-duplicate layout, most sections
delegate to two shared primitives: `CardGrid` (a pure responsive-grid
layout primitive, no opinion on card shape) and `Card` (icon/photo +
title + description + CTA). `Section`/`Container`/`Heading`/`Button`
give every section the same spacing, type scale, and tone (light/muted/
dark/brand) instead of each one picking its own.

A `SECTION_REGISTRY` maps each section's `type` to its component plus
metadata: which of `apps/api`'s `sitemaps.models.PageType` values it
suits, and which config fields are required. `getSectionsForPageType()`
is the query surface the website generator (roadmap M5, next) will use
instead of hardcoding "services page gets a service-cards section" —
and `validateSection()` reports missing required fields without ever
inventing a value to satisfy them, which is the same "flag, don't
fabricate" contract the Anti-Slop system builds on next.

**Why:** the generator needs a fixed, reviewable set of building blocks
"instead of repeatedly inventing UI" (operator's framing) — a config-
driven library makes both "which sections exist" and "what content each
one needs" explicit and testable ahead of any generation logic
existing, rather than emerging ad hoc inside a prompt.

**Alternatives considered:** one large parameterized `Section` component
covering every layout via a `variant` prop — rejected, the config shapes
(e.g. `PricingTier` vs `Testimonial`) are different enough that one
mega-type would need most fields optional, defeating the point of
flagging missing content per section type. A full Next.js app inside
`packages/` — rejected for now; nothing here needs a dev server or its
own routing, and the eventual generated site owns that.

---

## 2026-08-19 — Lead-to-client conversion now creates the Project too; project pipeline redesigned to the operator's 12 stages

**Decision:** Converting a won lead (`POST /api/v1/clients` with
`from_lead_id`, unchanged entry point — see the 2026-08-16 dashboard
entry below for why this is the "deal closed" event) now does the full
lead-to-client conversion workflow in one transaction, not just the
Client half:

- Creates the Client (unchanged) and, new: one Project at `INTAKE`,
  named `project_name` or `"{business name} Website"`, plus its starter
  task checklist (`app/modules/projects/service.py`'s
  `DEFAULT_INTAKE_TASK_TITLES` — confirm scope, collect assets, schedule
  kickoff). The checklist is only seeded on conversion, not on every
  manually-added project via `POST /api/v1/projects` — deliberately
  scoped to the workflow that was actually requested rather than
  changing that endpoint's existing behavior.
- `ClientCreate` gained `package`, `deadline`, and `project_name`
  (alongside the existing `won_price_cents`) — the agreed terms of the
  deal, captured once at the moment it's won. `package`/`won_price_cents`
  still also land on a new `SalesOpportunity` row (unchanged, feeds the
  dashboard's won/revenue metrics), and price/package/deadline are
  additionally stored directly on the new `Project`
  (`projects.package`/`price_cents`/`deadline`) — this is a deliberate,
  narrow duplication of the *value* at the moment of conversion (like an
  invoice recording a price), not a live-synced mirror: the Project owns
  its own engagement terms from creation on, independent of what happens
  to the sales-side opportunity later, and independent of whether a
  client's *next* project (a future redesign) has terms of its own.
- `projects.source_lead_id` (nullable FK → `leads.id`, `ON DELETE SET
  NULL`) is the direct traceability pointer from a project back to the
  lead it was converted from — added because `Project → Client →
  Business → Lead` is already a valid 1-1 traceability path (via
  `Business.lead`/`Business.client`, unchanged) for a client's *first*
  project, but stops being unambiguous the moment a client gets a second,
  independently-added project. Requirement: "the original lead must
  remain historically traceable to the client and project" — both halves
  now hold without a guessing join. The lead row itself is never touched
  beyond `status -> WON` (unchanged from before); every audit,
  interaction, sales audit, and outreach message already belongs to the
  lead and was never at risk of being deleted or duplicated by this
  change, since none of that is copied — only referenced.
- Converting the same lead twice now 409s ("This lead has already been
  converted to a client") instead of hitting a raw unique-constraint
  `IntegrityError` — a pre-existing gap (checked via
  `lead.business.client is not None` before doing anything).

**Project stage pipeline redesigned** to the exact 12 stages the
operator specified for this workflow: `INTAKE → RESEARCH → BRIEF →
DESIGN → DEVELOPMENT → QA → CLIENT_REVIEW → REVISIONS → READY_TO_DEPLOY →
DEPLOYED → MAINTENANCE → COMPLETE`, replacing the earlier set (`INTAKE,
PROJECT, RESEARCH, DESIGN_BRIEF, SITEMAP, COPY, WEBSITE, QA, MY_APPROVAL,
CLIENT_APPROVAL, DEPLOYMENT, MAINTENANCE`). Migration
`e8b2f4a91c3d_project_stage_redesign_conversion` remaps any existing
rows (`DESIGN_BRIEF→BRIEF`, `SITEMAP`/`COPY→DESIGN`, `WEBSITE→
DEVELOPMENT`, `MY_APPROVAL→QA`, `CLIENT_APPROVAL→CLIENT_REVIEW`,
`DEPLOYMENT→READY_TO_DEPLOY`, `PROJECT→INTAKE`) rather than dropping
data, with the inverse mapping in `downgrade()`. `active_projects` on the
dashboard now excludes both `MAINTENANCE` and `COMPLETE` (previously
just `MAINTENANCE`, back when it was the last stage) — see
`app/modules/dashboard/service.py`.

Frontend: the lead detail page gained a "Convert to client" section
(package/price/deadline/project name/billing email/assignee, shown
until a client already exists for that lead's business) as the intended
entry point for "a lead is marked WON" — the existing Clients-page
convert form still works too, both call the same endpoint. The Projects
table shows the current stage as both a label and the existing editable
dropdown (kept a table per the M1 kanban-vs-table decision, not turned
into a board), plus new Package/Price/Deadline columns and a "from lead"
link back to the source lead; the client detail page's project list
shows the same stage label and lead link.

**Why:** This is `docs/04_ROADMAP.md` M4's last open item ("Client
intake form → auto-creates a project record"), operationalized as
"convert a won lead" since that's the existing, real trigger for
becoming a client in this app — there's no separate intake-form UI to
re-key from. The specific 12-stage pipeline, the agreed-terms fields,
and the traceability requirement were specified directly by the
operator for this piece of work.

**Alternatives considered:** A separate `POST /api/v1/leads/{id}/convert`
endpoint instead of extending the existing `POST /api/v1/clients` —
rejected; the conversion behavior (mark lead WON, create Client) already
lived in `clients.service.create_client`'s `from_lead_id` branch, and
splitting "create the client" from "create its first project" into two
round-trips would reopen the exact "won_projects/revenue metric
unreachable" gap the 2026-08-16 dashboard entry fixed by making
conversion atomic. Storing package/price/deadline only on
`SalesOpportunity` and reading them onto `ProjectRead` via a join at
request time — rejected as a more fragile design for the same
information: it would require guessing *which* opportunity belongs to
*which* project for any client with more than one project, exactly the
ambiguity `source_lead_id` was added to avoid; a value captured once at
creation and owned by the project from then on is simpler and doesn't
silently go stale if a later opportunity is added against the same
lead. Auto-seeding the starter task checklist on every `POST
/api/v1/projects` call, not just conversions — considered for
consistency, rejected as changing established behavior of an existing
endpoint beyond what was asked.

---

## 2026-08-18 — Meeting preparation system: brief restructured into BUSINESS/WEBSITE/SALES/DISCOVERY, facts split out of the LLM entirely

**Decision:** Rebuilt the meeting brief (introduced same day in the
Calendar Integration entry below, then a plain summary/talking-points/
open-items shape) into the four sections the operator asked for —
BUSINESS (name, industry, location, website), WEBSITE (strengths,
weaknesses, opportunities), SALES (lead score, previous interactions,
outreach history, objections), DISCOVERY (questions to ask, likely
requirements, possible package, suggested pricing range) — per the
explicit "do not invent information" requirement.

BUSINESS/WEBSITE/SALES and the package/pricing note are assembled in
`modules/meetings/service.py`'s `_gather_brief_facts` as a **pure
database read** — the business record, the latest Sales Audit's
`website_strengths`/`top_problems`/`recommended_improvements`/
`potential_objections`, `Interaction` rows, and `OutreachMessage` rows,
copied through unchanged. `possible_package`/`suggested_pricing_range`
are resolved by matching the latest Sales Audit's free-text
`suggested_offer` against the three real tier names (Simple/Core/
Advanced, `_PRICE_TIERS`) — never a new number. None of this reaches
`agents/meeting_brief.py` at all. Only `questions_to_ask` and
`likely_requirements` — the two fields that genuinely require
synthesis rather than lookup — go through the LLM, given the assembled
facts as grounding and the same "never state a number not already in
the record" guardrail the Sales Audit prompt uses.

Brief generation no longer requires an LLM key to produce a row: with
no key configured (or on an LLM failure), the deterministic sections
still populate and only the discovery fields come back empty,
`flagged_for_review=True`, with a `review_notes` explanation — better
than the previous all-or-nothing skip, since the facts a rep actually
needs before a call don't depend on the LLM being available. Added
`POST /api/v1/meetings/{id}/brief` (rate-limited, lead-side meetings
only) to regenerate on demand — e.g. after a new Sales Audit lands, or
for a meeting booked before this feature existed — alongside the
existing automatic generation on booking; this doesn't reverse the
"automatic, not manual-only" call in the Calendar Integration entry
below, it adds an explicit refresh path on top of it.

**Why:** Structurally preventing invention is stronger than prompting
for it — a fact the LLM never receives as a "you may say numbers here"
license can't be misstated by it. Splitting facts from synthesis also
means a brief is never blocked on LLM availability, which matters for
something meant to be "read immediately before a call."

**Alternatives considered:** Asking the LLM to reproduce the stored
facts verbatim alongside the two synthesized fields — rejected; it adds
a failure mode (paraphrasing, omission, drift from the source record)
for zero benefit over a direct copy. Skipping the whole brief when no
LLM key is configured, matching the original all-or-nothing behavior —
rejected once the fact sections stopped depending on the LLM, since
withholding accurate, available information because an unrelated
field can't be generated no longer made sense.

---

## 2026-08-18 — Calendar Integration: Google Calendar, per-user OAuth, one-directional sync; meeting_type/status/assigned_user/duration added; auto lead-status bump + auto meeting brief on booking

**Decision:** Implements the requested workflow — INTERESTED LEAD →
MEETING BOOKED → CALENDAR EVENT → LEAD UPDATED → MEETING BRIEF — on top
of the Calendar + Client Management feature below. Recommendation given
before building, per the operator's explicit ask to "recommend the
simplest appropriate calendar integration" first:

**Google Calendar, OAuth 2.0, connected per user, one-directional.** One
registered Google Cloud OAuth app for the whole product
(`GOOGLE_CALENDAR_CLIENT_ID`/`SECRET`, same tier as `LLM_API_KEY`); each
teammate individually grants consent from Settings — not a shared
workspace calendar, since a meeting's event needs to land on whoever is
actually assigned to it. Sync is one-directional (this app pushes
meeting events out; it never reads the connected calendar back) — no
webhook receiver, no availability/conflict checking, matching this
project's standing "no infra we don't need yet" posture (see the
overengineering-guardrails entry below). Least-privilege scope
(`calendar.events` + `openid email`, not the full `calendar` scope).

Concretely:

- **`meetings` gained real fields**: `meeting_type`
  (`sales_call`/`client_check_in`/`other`, defaulted from the parent —
  lead → sales_call, project → client_check_in — but overridable),
  `status` (`scheduled` → `held`/`cancelled`/`no_show`, replacing the
  old held_at-only implicit state), `duration_minutes` (default 30, now
  needed for a real calendar event's end time), `assigned_user_id`
  (defaults to the parent lead/project's own assignment when omitted,
  explicit value otherwise), and `external_event_id` (the synced Google
  event id). Adding `assigned_user_id` to `Meeting` **reverses** the
  same-day earlier decision (below) that deliberately left it off,
  citing [[01_REQUIREMENTS]]'s four-entity list — the operator's
  explicit "Need: assigned user" requirement, plus the fact that
  calendar sync genuinely needs to know *whose* calendar to push to,
  overrides that reasoning.
- **New `integrations/google_calendar.py`** — the thin OAuth + Calendar
  API adapter (auth URL, code exchange, refresh, create/update/delete
  event). Every write passes `sendUpdates=none` and never sets
  attendees — a booked meeting must never trigger Google to email the
  lead/client an invite, per the operator's explicit "no unnecessary
  emails" instruction.
- **New `calendar_connections` table** (`modules/calendar/models.py`) —
  one row per user, storing only a Fernet-encrypted refresh token
  (`app/core/crypto.py`, `CALENDAR_TOKEN_ENCRYPTION_KEY`). Access tokens
  are fetched on demand via the refresh token and never persisted — "no
  token in plaintext" is satisfied by not storing the sensitive
  short-lived one at all, and encrypting (not just hashing, since it
  must be read back) the long-lived one. Split into a separate
  `modules/calendar/connections.py` file from the existing
  `modules/calendar/service.py` (the meetings+tasks aggregation) purely
  to avoid a circular import — `service.py` already imports
  `modules/meetings/service.py`, and `meetings/service.py` needs the
  connection/token helpers to sync a booked meeting.
- **CALENDAR EVENT** — `modules/meetings/service.py`'s
  `_sync_to_google_calendar` runs after a meeting is created or
  rescheduled/reassigned: best-effort, never fatal. No connection, an
  expired/revoked token, or a Google API failure all silently no-op
  (logged, not surfaced) — the meeting is still booked in this app
  either way. A `status` transition to `cancelled`/`no_show` deletes the
  synced event; reassigning a meeting deletes it from the previous
  assignee's calendar and creates it on the new one.
- **LEAD UPDATED** — booking a lead-side meeting bumps `lead.status` to
  `MEETING` (an existing `LeadStatus` value, previously never
  auto-written), but only forward: a lead already at
  `PROPOSAL`/`WON`/`LOST`/`NURTURE` or a later meeting isn't regressed.
  Recorded in `activity_log` like every other status change.
- **MEETING BRIEF** — new `agents/meeting_brief.py` (the "Meeting
  preparation" role [[02_ARCHITECTURE]] §6 listed as deferred) runs
  automatically for lead-side meetings only, synthesizing the lead's
  existing sales audit, prior outreach, and prior meeting history into a
  short brief (summary, talking points, open items) — no new external
  data is fetched, this is pure synthesis via `integrations/llm.py`,
  same `AgentResult`/`flagged_for_review` shape as every other agent.
  Skipped entirely (not attempted) if `LLM_API_KEY` is unset, and any
  other failure is caught and logged rather than blocking the
  meeting-booking request that triggered it — generating a brief must
  never be a reason a meeting fails to get booked. `POST
  /api/v1/meetings` now sits behind `enforce_generation_rate_limit`
  (shared bucket with Sales Audit/Outreach/Follow-up) since it can
  trigger this LLM call.
- **OAuth CSRF**: the `state` param is signed (itsdangerous, its own
  salt, 10-minute expiry) and, on callback, checked against the
  *already-authenticated* session's user id — not just "is this validly
  signed by anyone." The callback route requires the normal session
  cookie (it's a same-origin top-level redirect back to this app, so the
  cookie is present) rather than trusting the state param alone to
  identify the user.

**Why:** Every element of the "Need" list maps directly to a schema/UI
change above; "Use OAuth securely" is the per-user encrypted-refresh-
token + signed-state design; "Never store access tokens in plaintext"
is satisfied by never storing the access token at all and encrypting the
refresh token; "Do not automatically send unnecessary emails" is
`sendUpdates=none` + no attendees, checked at the one integration point
that talks to Google, not scattered across call sites.

**Alternatives considered:** A shared workspace-level Google Calendar
connection instead of per-user — rejected because "assigned user" is an
explicit requirement and a two-person shop's calendars are personal, not
shared; an event needs to land on the actual assignee's calendar for
this to be useful day to day. Two-directional sync (reading the
connected calendar back for availability/conflict checking) — rejected
as scope creep for this pass; nothing in the requested workflow needs it
and it would require a webhook receiver or polling, both real
infrastructure this app doesn't have yet. A generic multi-provider
calendar abstraction (Outlook/CalDAV alongside Google) — rejected same
as the single-LLM-provider decision below: one provider, one adapter,
until a second is actually needed. Making the meeting brief a manual
"Generate brief" button (matching Sales Audit's UX) instead of automatic
— rejected because the operator's instruction was specifically "when a
meeting is booked, automatically prepare a meeting brief," not on
request.

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
