# UI/UX Redesign Plan — Web Design OS

Date: 2026-09-14
Scope: audit + implementation plan for the commercial-quality visual/UX
overhaul (task T-UI1). No business logic, database schema, or API
contract changes anywhere in this initiative — see [[08_WORKFLOW_AUDIT]]
for the (separate, already-addressed) workflow-level audit, which
explicitly excluded visual design. This document is the visual/UX
counterpart that audit deferred.

Six agents are working this initiative in parallel worktrees. One agent
(this document's author) builds the shared foundation in strict order —
audit → design system → app shell → Sales benchmark — committing and
pushing each step to `main` before the next starts. The other five then
redesign individual pages against that foundation. This document is
the contract between them: shared components, tokens, and priorities
every page redesign should build on rather than reinvent.

---

## 0. Headline finding: this is consolidation, not a rebuild

Before assuming the app needs a ground-up visual rewrite: it doesn't.
`apps/web/src/app/globals.css` already defines a real token system
(`--canvas`/`--surface`/`--surface-subtle`/`--surface-hover`/`--border`/
`--border-strong`/`--fg`/`--fg-muted`/`--fg-subtle`/`--accent`/
`--focus-ring`/`--danger`, light + dark values, driven by a
`data-theme` attribute with a `prefers-color-scheme` fallback and no
flash-of-wrong-theme), a working component-class layer (`.btn`/`.input`/
`.card`/`.panel`/`.table`/`.page-title`/`.modal-overlay` etc.), and a
meaningful `components/ui/` set (`PageHeader`, `Panel`/`ItemRow`/
`EmptyRow`, `Metric`/`MetricGrid`, `EmptyState`, `ErrorState`,
`Skeleton`/`TableSkeleton`/`ListSkeleton`, `Tabs` (`TabBar`),
`Disclosure`, `ProgressBar`, `ConfirmProvider`, `ToastProvider`, a
genuine hand-drawn `NavIcon` set). The Sales page is built almost
entirely from these primitives already, and Settings was redesigned
2026-09-13 into a clean category-nav layout. Accessibility basics
(`aria-modal`, `role="alertdialog"`, `aria-live`, focus rings, keyboard
tab semantics) are already present in the shared providers.

**The actual problem is inconsistent adoption, not a missing system.**
Roughly a dozen pages each independently reinvented a small piece of UI
the shared system either already solves or should be extended to solve.
The plan below is deliberately about **consolidating onto the existing
foundation** — extending it where a real gap exists (chiefly: no shared
Badge/status-pill primitive) — not introducing a new visual language,
a new component library, or a new dependency.

---

## 1. What currently works well (preserve, extend, don't discard)

- **Design tokens** (`globals.css`) — one place for light/dark, already
  disciplined ("every color used by app UI should come from one of
  these tokens... not a raw Tailwind neutral-* shade"). Keep this
  convention; extend it (§3) rather than replace it.
- **`PageHeader`** — used on *every* page already. The one truly
  universal primitive in the app. No changes needed to its contract.
- **`EmptyState` / `ErrorState`** — used broadly and consistently, both
  full and `compact` variants. No changes needed.
- **`ProgressBar`** — used consistently everywhere a completion
  percentage appears (Leads checklist cell, Client/Project cards), with
  proper `aria-valuetext`. No duplication found anywhere.
- **`ConfirmProvider` / `ToastProvider`** — promise-based confirm dialog
  and fire-and-forget toasts, mounted once at the shell root, already
  token-driven and accessible. Genuinely good primitives; reuse as-is.
- **The Sales page** (`app/dashboard/sales/page.tsx`) — see §6. The
  strongest page in the app: terse 6-metric strip, two-panel row,
  one tabbed activity panel, minimal CTA hierarchy (one primary + one
  secondary header action, everything else a text-link "→"). This is
  the explicit visual benchmark for the initiative.
- **Settings** (redesigned 2026-09-13) — category left-nav (desktop) /
  `TabBar` (mobile), `?section=` deep-linked, `.card` + `section-title`
  + `InfoRow` rhythm throughout. Second-best reference page.
- **Clients/Projects card grids** (`ClientCard`/`ProjectCard`) — two
  independently-built cards that converged on an *identical* shape
  (badge row → title → subtitle → progress bar → "Next: …" line →
  footer meta row). Strong evidence this shape is the right one; formalize
  it (§4) rather than leave it duplicated.
- **The sidebar's workflow-based grouping** (`lib/nav.ts`) — already
  organized as Workspace / Discover / Sales / Build / Manage / System,
  explicitly redone as a UX pass (see the file's own header comment
  referencing this exact "what am I doing here, not a CRM feature list"
  principle) rather than a raw list of database objects. **Prompt 03
  should not blindly restructure this** — it already satisfies the
  brief's own stated requirement. Prompt 03's job is visual/interaction
  polish (spacing, active-state clarity, focus states, icon consistency,
  mobile drawer polish) on top of an already-sound structure, revisited
  only if hands-on testing surfaces real confusion.
- **The hand-drawn `NavIcon` set** (`components/ui/Icons.tsx`) — a
  real, coherent 24px-grid, `currentColor`-stroke icon set, not a mixed
  bag of emoji/third-party icons. Currently sidebar-only; extend its use
  into page bodies (status icons, metric icons) rather than introducing
  a second icon set or a library dependency.
- **Disclosure-based progressive disclosure** — used well on Follow-ups
  ("Generate a follow-up", collapsed) and as the core pattern on Lead
  detail. Keep the pattern; Lead detail's specific execution is flagged
  as overloaded below.

---

## 2. What's cluttered / inconsistent (the actual redesign targets)

### 2.1 No shared Badge/status-pill primitive — the single highest-value fix
Three near-identical, independently hand-rolled entity badges exist:
`components/LeadStatusBadge.tsx`, `ClientStatusBadge.tsx`,
`ProjectStatusBadge.tsx` — each a `Record<Tone, string>` map of
`bg-*-100 text-*-800 dark:bg-*-500/15 dark:text-*-300` feeding one
`<span>`. `LeadStatusBadge`'s own comment ("Five tones, not ten status
colours — same restraint as ProjectStatusBadge") shows the team already
converged on the same palette three times without factoring it out.

Beyond those three, **at least 7 page files** contain fully inline,
un-componentized status-color pills (`review/page.tsx`'s `CATEGORY_STYLE`
+ Instagram check-state badges, `leads/page.tsx`'s local
`InPlanningBadge`, `sales/page.tsx`'s inline Won/Lost pill,
`leads/[id]/page.tsx`, `planning/**`, `projects/[id]/page.tsx`,
`calendar/page.tsx`), and **at least 6 independent 3–4-tone
"urgency" color maps** duplicate the same danger/warn/muted(/subtle)
semantics with separately hand-typed Tailwind strings: `ItemRow`'s
`rightTone`, `DoThisNext`'s `BADGE_CLASS` (8 hardcoded kind→color
pairs — the richest existing instance), Tasks' `URGENCY_CLASS`,
Projects' `DEADLINE_CLASS`, Today's `PRIORITY_TONE`, Settings'
`ProviderRow` badge (text-only, a fifth variant with no pill at all).

**This is the one clear gap in the existing system** (everything else in
§1 already exists) and the top priority for the design-system phase.

### 2.2 Three parallel "tab switcher" implementations
`components/ui/Tabs.tsx` (`TabBar`, underline style) exists and is used
only on Settings. Leads (List/Board toggle), Tasks (status tabs), and
Sales (activity tabs, built as raw buttons in a `Panel`'s `right` slot)
each independently reimplement a segmented-control/pill-button toggle
with near-identical markup. One tab component, three reinventions.

### 2.3 Three parallel "show some numbers" conventions
`Metric`/`MetricGrid` (Sales, Today) vs. Clients' plain inline-text
summary line (`12 Clients · 8 Active · …`) vs. Lead/Client detail's
3-card `field()`-grid "at a glance" layout. All three answer the same
UX question ("what are the headline numbers on this page") differently.

### 2.4 `field()`/`summaryRow()` label-value helpers duplicated verbatim
The exact same small `field(label, value)` helper function is
copy-pasted into Lead detail, Client detail, and (per the fork survey)
a third location — a direct candidate for one shared `DetailField`/
`FieldRow` component in `components/ui/`.

### 2.5 `.input` utility class used inconsistently
Clients, Projects, and Tasks consistently use the `.input` component
class from `globals.css`. Leads' filter row and manual-entry forms, and
most of Lead detail's edit forms, use raw inline Tailwind
(`rounded-md border border-border-strong px-3 py-1.5 text-sm`) instead
— same visual result today, but two sources of truth that will drift.

### 2.6 `Panel`/`ItemRow` under-adopted
`Panel` + `ItemRow` + `EmptyRow` (Sales, Today) is the app's real
"bordered titled list module" primitive, but Follow-ups, Review, Tasks,
and Lead detail's History sections each hand-roll visually-similar
bordered `<ul>` lists instead of reusing it. Not every case needs to
convert (Follow-ups' triage buckets have real structural differences —
snooze/resolve actions, multi-line rows — that don't fit `ItemRow`'s
two-line shape as-is), but the plain "bordered list of activity/history
rows" case should converge on `Panel`.

### 2.7 Lead detail (`leads/[id]/page.tsx`, 1375 lines) — most overloaded page
Three always-visible `field()` cards, two always-visible "bridge"
sections (Planning, Project/website), a `StageChecklistPanel`, then
four large stacked `Disclosure` blocks each containing multiple
un-nested sub-sections (business/lead edit form, proposal log + sales
audit + outreach drafts, meetings + pipeline history + activity).
Nearly every CRM concept in the app surfaces somewhere on this one
route. The glance-cards → primary-next-action bridges → collapsed-detail
ordering is the right instinct and should be kept; the redesign should
tighten each Disclosure's internal density (sub-sections currently read
as a second full page each), not restructure the overall flow. **Not
one of the four foundation prompts** — flagged here as the single
highest-priority page for the follow-on page-by-page redesign work.

### 2.8 Review queue — already flagged by the prior workflow audit
[[08_WORKFLOW_AUDIT]] G3 already calls this page out for speaking
"pipeline-internal language" (originally 13 columns, now 8, still
dense) and recommends stripping it to Business/Location/Website
status/Score/one "why review" line/Approve/Reject, moving
Confidence/Source/Audit-summary into a deep-dive or row expander. The
visual redesign should implement that already-agreed simplification,
not just re-skin the current 8-column table — and replace its three
local ad-hoc badge systems (`CATEGORY_STYLE`, Instagram check-state,
inline emerald/red action links) with the new shared Badge.

### 2.9 Leads list — dual mobile-card/desktop-table row duplication
A reasonable responsive pattern (two full renderings of the same row
data) but real duplication worth a shared row-renderer if a page-level
redesign touches this file.

---

## 3. Design token strategy (for the Prompt 02 phase)

**Extend, don't replace** `globals.css`'s existing token set. Concrete
additions:

1. **Status/tone color tokens.** Add `--status-success`/`-success-bg`,
   `--status-warning`/`-warning-bg`, `--status-danger`/`-danger-bg`
   (`--danger` already exists — reuse it), `--status-info`/`-info-bg`,
   each with a light + dark value, replacing the ad-hoc
   `bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15
   dark:text-emerald-300`-style literals scattered across ~15 files.
   This is what makes a single `<Badge>` component (§4) possible without
   hardcoding Tailwind color names inside it.
2. Keep the neutral surface/border/fg scale exactly as-is — it's
   already well-designed and nothing in the audit found a gap there.
3. **Dark-first verification, not a default-theme change.** The design
   brief calls for a "clean, dark, professional" flagship look.
   `ThemeProvider` already supports light/dark/system with no flash and
   defaults new sessions to `system` (respecting OS preference) — that
   existing behavior is not changed by this initiative (no user asked
   for a forced-dark default, and changing it would be a behavior
   change beyond "shared visual foundation"). What *does* change:
   every new/refactored component in Prompt 02 is designed and reviewed
   dark-first, then verified in light, so the dark palette is the
   polished flagship experience the brief asks for while light mode
   stays fully supported.
4. Border radius, shadow, and spacing scale: no new tokens needed —
   Tailwind's defaults plus the existing `rounded-md` convention are
   used consistently already (`.card`/`.panel`/`.input`/`.btn` all use
   `rounded-md`). Formalize this as the standing rule (one radius scale
   step for all interactive/container elements; no page introduces its
   own radius) rather than adding a `--radius-*` custom property nothing
   currently varies.

---

## 4. Shared component strategy (for the Prompt 02 phase)

New components to add to `components/ui/`:

- **`Badge`** — `<Badge tone="success|warning|danger|info|muted">`,
  built on the new status tokens from §3. `LeadStatusBadge`/
  `ClientStatusBadge`/`ProjectStatusBadge` become thin wrappers that map
  their own domain enum → tone and render `<Badge>` — same public API,
  zero call-site changes required elsewhere in the app. Every inline
  ad-hoc pill identified in §2.1 is a candidate to migrate opportunistically
  during each page's own redesign pass (not a mass find-replace in the
  foundation phase — out of scope for Prompt 02, which only needs to
  ship the primitive and convert the three entity badges as the proof
  of concept).
- **`DetailField`** (or `FieldRow`) — the label-value pair currently
  copy-pasted as a local `field()` helper in 3+ files.
- **`EntityCard`** (or formalize the shape as documented convention) —
  the badge/title/subtitle/progress/next-line/footer shape
  `ClientCard` and `ProjectCard` already independently converged on.
  Given both cards currently have entity-specific click targets and
  data shapes, prefer documenting the shared shape as a composable
  layout primitive (slots, not a rigid props contract) so
  page-redesign agents extract their own card into it rather than the
  foundation phase attempting a risky generic rewrite of two live pages
  it isn't otherwise touching.
- **Tab pattern decision (revised during Prompt 04 implementation)**:
  there are genuinely two different patterns here, not one. `TabBar`
  (underline style, full container width, a `border-b` cutting across
  it) is right for **page-level section switches** — Settings' usage is
  the model, and stays the standard for that job. Sales' activity
  switcher, Leads' List/Board toggle, and Tasks' status tabs are a
  different job — a **compact inline toggle** living inside a `Panel`
  header's small `right` slot or a filter row, where `TabBar`'s
  full-width underline doesn't fit. Attempting to force `TabBar` into
  Sales' `Panel` header during Prompt 04 confirmed this mismatch.
  Standardized instead on the segmented-control shape Leads' and Tasks'
  toggles already independently used (`rounded-md border
  border-border-strong p-0.5` pill group, `bg-accent text-accent-fg`
  active state) — Sales' activity switcher now matches that, with
  `role="tablist"`/`role="tab"`/`aria-selected` and a `focus-visible`
  ring added for accessibility. **Leads and Tasks already match this
  shape visually** (only Sales' switcher needed converting) — their
  page-redesign agents don't need to change anything for this specific
  gap, just carry the same pattern forward on their own pages.
- **Stat-display decision**: `Metric`/`MetricGrid` is the canonical
  "headline numbers" component. Don't add a second one — Clients' inline
  summary and Lead/Client detail's `field()`-card grid are candidates
  for individual page-redesign agents to reconsider against `Metric`,
  not a foundation-phase change (those pages aren't touched by Prompts
  01–04).

No new dependency, icon library, or CSS framework is needed anywhere in
this plan — every gap above is closed with a new `components/ui/`
component built the same way the existing ones are (Tailwind utility
classes + the token layer), consistent with [[03_AGENT_RULES]]'s
existing instruction to reuse `globals.css`/`components/ui/` rather than
invent new visual language per page.

---

## 5. App shell strategy (for the Prompt 03 phase)

- Keep `lib/nav.ts`'s six-section grouping (Workspace / Discover / Sales
  / Build / Manage / System) — see §1, this already satisfies "what am
  I doing here" over "list every database object."
  Verify secondary/primary distinction still reads as a hierarchy after the
  design-system token pass (Prompt 02) changes are applied.
- Re-skin `dashboard/layout.tsx`'s sidebar/`BottomNav`/mobile drawer with
  the finished tokens from Prompt 02 — active-state contrast, hover
  states, focus rings for keyboard nav, and the count-badge treatment
  should all come from the shared system rather than the current
  page-local Tailwind strings in the layout file itself.
- Do not change `NAV_SECTIONS` data shape, hrefs, `isNavLinkActive`
  logic, or `MOBILE_PRIMARY_HREFS` — every existing link must keep
  working exactly as it does today; this is a visual pass on an
  already-correct structure, not a route change.
- Verify all ~19 dashboard routes still render and every nav link still
  resolves after the shell restyle (full list in [[08_WORKFLOW_AUDIT]]
  §1 and confirmed directly against `apps/web/src/app/dashboard/*` for
  this document).

---

## 6. Sales page — what to preserve vs. what to fix (for the Prompt 04 phase)

**Preserve as the benchmark pattern:**
- `PageHeader` + exactly one primary + one secondary header action.
- 6-tile `Metric`/`MetricGrid` strip with skeleton loading.
- Two-`Panel` row (Hot leads / Needs follow-up) using `ItemRow`/
  `EmptyRow`.
- One wide `Panel` with a tabbed activity view underneath (Outreach/
  Proposals/Closed/Meetings) — the *concept* (one panel, switchable
  content, instead of four stacked lists) is right and should be kept.
- Minimal CTA hierarchy: text-link "→" for secondary navigation inside
  panels, never a second competing button.

**Fixed within Sales itself, using the Prompt 02 primitives (done):**
- Replaced the inline Won/Lost pill in the "Closed" tab with the new
  shared `Badge` (`tone="success"`/`"muted"`).
- Restyled the activity switcher onto the segmented-control shape Leads/
  Tasks already use (§4's revised tab-pattern decision — `TabBar` didn't
  fit the `Panel` header slot), added proper `role="tablist"`/`"tab"`/
  `aria-selected` and a `focus-visible` ring.
- Added `focus-visible` rings to the two "→" panel-header links, matching
  the shell's Prompt 03 focus-state pass.

**Preserve all existing functionality exactly:** six real metrics
(`hot_leads_count`, `needs_follow_up_count`, `proposals_count`,
`estimated_revenue_cents`, `won_deals_count`/`conversion_rate_pct`,
`actual_revenue_cents`), hot-leads list, three-bucket follow-up list,
four-tab activity panel (outreach/proposals/closed/meetings), all
existing links (`/dashboard/leads`, `/dashboard/follow-ups`,
`/dashboard/calendar`, per-lead detail links), "Add lead"/"Find leads"
header actions. Nothing here is invented or removed — this phase is a
visual/structural tightening of an already-good page, not a feature
change.

---

## 7. Page-by-page redesign priorities (for the five page-redesign agents)

Ordered by (severity of clutter × how much it blocks the "commercially
viable" bar), independent of which agent picks up which page:

1. **Lead detail** (`leads/[id]/page.tsx`) — highest density, most
   duplicated helpers, most CRM concepts on one route (§2.7).
2. **Review queue** (`review/page.tsx`) — has a pre-existing, agreed
   simplification spec from [[08_WORKFLOW_AUDIT]] G3 waiting to be
   executed, plus three ad-hoc badge systems to replace (§2.8).
3. **Dashboard / Today** (`dashboard/page.tsx`) — already fairly clean
   (§1); mainly needs the `Metric`/tone-token consolidation and a pass
   to make sure it doesn't regress once `DoThisNext`'s tone map moves to
   the shared Badge system.
4. **Leads list** (`leads/page.tsx`) — `.input` consistency (§2.5),
   List/Board toggle → `TabBar` (§2.2), consider a shared row-renderer
   for the mobile-card/desktop-table duplication (§2.9).
5. **Clients** (list + detail) — list is already close to the Sales/
   Projects bar; detail shares Lead detail's `field()`-card duplication
   and always-visible-vs-disclosed edit-form inconsistency (§2.4).
6. **Projects** — closest to done of the remaining pages (`ProjectCard`
   already matches `ClientCard`'s shape); mainly tone-map consolidation
   (`DEADLINE_CLASS` → shared urgency tone) and `EntityCard`
   formalization (§4).
7. **Follow-ups** and **Tasks** — already clean and well-organized
   (§1); lowest-priority, mostly tone/tab consolidation once the shared
   primitives exist.

Discovery, discovered-businesses detail, planning, calendar, and the
build/website workspace pages exist and were skimmed but are outside
the ten pages named in the original brief — not assigned to the five
redesign agents by this plan; leave them on the existing design system
without modification unless a later task explicitly adds them.

---

## 8. Implementation order (this document's author, Prompts 01–04)

1. ~~Audit (this document)~~ — commit + push.
2. Design system: `Badge` + status tokens + `DetailField`, convert the
   three entity badges to wrap `Badge`, document the `TabBar`/`Metric`/
   `EntityCard` conventions above. Build + typecheck + lint clean —
   commit + push.
3. App shell: re-skin sidebar/`BottomNav`/mobile drawer on the new
   tokens, verify every route/link. Build + typecheck + lint clean —
   commit + push.
4. Sales benchmark: apply `Badge`/`TabBar` fixes from §6, verify every
   existing Sales function (metrics, links, tabs, header actions).
   Build + typecheck + lint clean — commit + push.
5. Release the five page-redesign agents against this document.

---

## 9. Risks

- **Badge migration scope creep.** §2.1 identifies ~15 files with ad-hoc
  status color logic. Converting all of them is explicitly *not* part
  of Prompts 01–04 (only the 3 entity badges are converted, as proof of
  concept) — each page-redesign agent converts its own page's instances
  as it goes. Risk: if an agent skips this, the inconsistency persists
  piecemeal. Mitigation: this document calls it out per-page in §7.
- **Sales' `TabBar` swap changing behavior.** The current inline tab
  buttons and `TabBar` render differently (underline vs. filled pill).
  Verify no test or visual regression depends on the old markup
  (`grep` for test selectors against the activity-tab buttons before
  changing them).
- **Shell restyle touching every route at once.** `dashboard/layout.tsx`
  wraps all ~19 routes — a mistake here is maximally visible. Mitigate
  by testing navigation on desktop, tablet-drawer, and mobile-bottom-nav
  breakpoints before pushing, not just a single viewport.
- **Five parallel agents converging on the same new primitives
  differently.** Since `Badge`/`TabBar`-standardization/`EntityCard` are
  introduced or clarified in Prompt 02 but *used* by later, independent
  page-redesign agents, drift is possible if an agent doesn't read this
  document. Mitigation: this document is the explicit hand-off contract;
  each shared component's props/usage should be documented in its own
  file's doc-comment (matching the existing convention in `Panel.tsx`/
  `PageHeader.tsx`) so an agent can learn the contract from the code
  directly, not only from this plan.
- **Theme default.** Explicitly not changing `ThemeProvider`'s
  `system` default (see §3.3) — flagging here so no downstream agent
  "fixes" this into a forced-dark default as a side effect of chasing
  the "dark, professional" brief language.

---

## 10. Functionality that must be preserved (recap)

No business logic, database schema, or API contract changes anywhere in
this initiative. Every existing route in `lib/nav.ts` /
`app/dashboard/**` keeps working with its current href. Every existing
page action (approve/reject, archive/restore, convert-to-client, log
proposal, generate outreach/audit/follow-up, snooze/resolve, bulk
approve, task toggle, etc.) keeps working exactly as today — this is a
visual and information-hierarchy pass, not a feature or workflow change
(workflow changes are already covered, separately, by
[[08_WORKFLOW_AUDIT]] and its own T2–T5 tasks).
